export interface WikidataSubtopic {
  id: string;
  label: string;
  description?: string;
  wikidataUrl: string;
}

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULT_LANGUAGE = "en";
const MAX_TOPIC_LABEL_CHARS = 120;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g;
const WHITESPACE_PATTERN = /\s+/g;

const extractWikidataEntityId = (entityUri: string): string | null => {
  const match = /\/entity\/(Q\d+)$/.exec(entityUri);
  return match ? match[1] : null;
};

const normalizeTopicLabelForEntitySearch = (topicLabel: string): string => {
  const normalized = topicLabel
    .replace(CONTROL_CHAR_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()
    .slice(0, MAX_TOPIC_LABEL_CHARS);

  if (import.meta.env.DEV) {
    console.assert(
      !CONTROL_CHAR_PATTERN.test(normalized),
      "normalizeTopicLabelForEntitySearch() returned control characters"
    );
  }

  return normalized;
};

const buildSubtopicsSparqlQuery = (
  topicLabel: string,
  language: string,
  searchLimit: number,
  resultLimit: number
): string => {
  const escapedLabel = topicLabel.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeLanguage = language.replace(/[^a-z-]/gi, "") || DEFAULT_LANGUAGE;
  const safeSearchLimit = Math.max(1, Math.min(searchLimit, 5));
  const safeResultLimit = Math.max(1, Math.min(resultLimit, 50));

  return `
    PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX schema: <http://schema.org/>
    PREFIX wikibase: <http://wikiba.se/ontology#>
    PREFIX bd: <http://www.bigdata.com/rdf#>
    PREFIX mwapi: <https://www.mediawiki.org/ontology#API/>

    SELECT ?child ?childLabel ?childDescription ?article WHERE {
  {
    SELECT ?topic WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:api "EntitySearch" ;
                        wikibase:endpoint "www.wikidata.org" ;
                        mwapi:search "${escapedLabel}" ;
                        mwapi:language "${safeLanguage}" ;
                        mwapi:limit ${safeSearchLimit} .
        ?topic wikibase:apiOutputItem mwapi:item .
      }
    }
    LIMIT 1
  }

  ?child wdt:P279 ?topic .

  OPTIONAL {
    ?child schema:description ?childDescription .
    FILTER(LANG(?childDescription) = "${safeLanguage}")
  }

  OPTIONAL {
    ?article schema:about ?child .
    ?article schema:isPartOf <https://${safeLanguage}.wikipedia.org/> .
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "${safeLanguage}" . }
}
LIMIT ${safeResultLimit}
`.trim();
};

export const fetchWikidataSubtopics = async (
  topicLabel: string,
  options?: {
    language?: string;
    resultLimit?: number;
    searchLimit?: number;
    timeoutMs?: number;
  }
): Promise<WikidataSubtopic[]> => {
  const trimmedLabel = normalizeTopicLabelForEntitySearch(topicLabel);
  if (!trimmedLabel) return [];

  const language = options?.language ?? DEFAULT_LANGUAGE;
  const resultLimit = options?.resultLimit ?? 12;
  const searchLimit = options?.searchLimit ?? 1;
  const timeoutMs = options?.timeoutMs ?? 30000;

  const query = buildSubtopicsSparqlQuery(
    trimmedLabel,
    language,
    searchLimit,
    resultLimit
  );

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort(new Error(`Wikidata request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const url = `${WIKIDATA_SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(
      query
    )}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/sparql-results+json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw new Error(
        `Wikidata SPARQL error: ${response.status} ${response.statusText}${
          responseText ? ` - ${responseText}` : ""
        }`
      );
    }

    const payload = (await response.json()) as any;
    const bindings: any[] = payload?.results?.bindings || [];

      const subtopics: WikidataSubtopic[] = [];
    for (const row of bindings) {
      const childUri = row?.child?.value;
      const childLabel = row?.childLabel?.value;
      if (!childUri || !childLabel) continue;

      const entityId = extractWikidataEntityId(childUri);
      if (!entityId) continue;

      const wikipediaUrl = row?.article?.value;

      subtopics.push({
        id: entityId,
        label: childLabel,
        description: row?.childDescription?.value,
        wikidataUrl: wikipediaUrl || `https://www.wikidata.org/wiki/${entityId}`,
      });
    }

    return subtopics;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const fetchWikipediaUrl = async (
  topicLabel: string,
  language: string = "en"
): Promise<string | null> => {
  const normalized = normalizeTopicLabelForEntitySearch(topicLabel);
  if (!normalized) return null;

  const endpoint = `https://${language}.wikipedia.org/w/api.php`;
  // Use action=query with redirects=1 to properly resolve redirects to the final article URL
  const params = new URLSearchParams({
    action: "query",
    titles: normalized,
    prop: "info",
    inprop: "url",
    redirects: "1",
    format: "json",
    origin: "*",
  });

  try {
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    
    if (data?.query?.pages) {
      const pages = data.query.pages;
      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];

      if (page && !page.missing && page.fullurl) {
        return page.fullurl;
      }
    }
  } catch (e) {
    console.error("Wikipedia lookup failed:", e);
  }
  return null;
};


