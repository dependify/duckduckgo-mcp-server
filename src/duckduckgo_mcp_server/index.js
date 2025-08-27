import { load } from 'cheerio';

const BASE_URL = "https://html.duckduckgo.com/html";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded",
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Simple routing based on path
        if (path === '/search') {
            const query = url.searchParams.get('q');
            const maxResults = parseInt(url.searchParams.get('max_results') || '10', 10);
            if (!query) {
                return new Response('Missing "q" search parameter', { status: 400 });
            }
            return searchDuckDuckGo(query, maxResults);
        }

        if (path === '/fetch-content') {
            const fetchUrl = url.searchParams.get('url');
             if (!fetchUrl) {
                return new Response('Missing "url" parameter', { status: 400 });
            }
            return fetchWebPageContent(fetchUrl);
        }

        return new Response('Not Found. Use /search?q=... or /fetch-content?url=...', { status: 404 });
    },
};

async function searchDuckDuckGo(query, maxResults) {
    try {
        const formData = new URLSearchParams();
        formData.append('q', query);
        
        const response = await fetch(BASE_URL, {
            method: 'POST',
            headers: HEADERS,
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const $ = load(html);

        const results = [];
        $('.result').each((i, el) => {
            if (results.length >= maxResults) return;

            const titleEl = $(el).find('.result__title a');
            const snippetEl = $(el).find('.result__snippet');

            let link = titleEl.attr('href');
            if (!link || link.includes('y.js')) return; // Skip ads

            if (link.startsWith('//duckduckgo.com/l/?uddg=')) {
                const urlParams = new URLSearchParams(link.split('?')[1]);
                link = urlParams.get('uddg');
            }

            const title = titleEl.text().trim();
            const snippet = snippetEl.text().trim();

            results.push({
                position: results.length + 1,
                title,
                link,
                snippet,
            });
        });
        
        // Format for LLM
        const formattedOutput = formatResultsForLlm(results);

        return new Response(formattedOutput, { headers: { 'Content-Type': 'text/plain' } });

    } catch (error) {
        console.error("Error during search:", error);
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function fetchWebPageContent(url) {
    try {
        const response = await fetch(url, {
             headers: { "User-Agent": HEADERS["User-Agent"] },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const html = await response.text();
        const $ = load(html);
        
        // Remove script, style, and other noise elements
        $('script, style, nav, header, footer').remove();
        
        let text = $('body').text();
        
        // Clean up whitespace
        text = text.replace(/\s\s+/g, ' ').trim();
        
        if (text.length > 8000) {
            text = text.substring(0, 8000) + "... [content truncated]";
        }

        return new Response(text, { headers: { 'Content-Type': 'text/plain' } });

    } catch (error) {
        console.error(`Error fetching content from ${url}:`, error);
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

function formatResultsForLlm(results) {
    if (!results || results.length === 0) {
        return "No results were found.";
    }
    let output = [`Found ${results.length} search results:\n`];
    for (const result of results) {
        output.push(`${result.position}. ${result.title}`);
        output.push(`   URL: ${result.link}`);
        output.push(`   Summary: ${result.snippet}`);
        output.push("");
    }
    return output.join('\n');
}
