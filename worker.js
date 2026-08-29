const ALLOWED_ORIGIN = "*";

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
        "Content-Type": "application/json; charset=utf-8"
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders()
    });
}

async function githubRequest(env, method = "GET", body = null) {
    const url =
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_FILE}`;

    const headers = {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DRIPVAULT-Worker"
    };

    const options = {
        method,
        headers
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    return fetch(url, options);
}

function decodeBase64(base64) {
    const binary = atob(base64.replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);

    let binary = "";

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(
            ...bytes.subarray(i, i + 0x8000)
        );
    }

    return btoa(binary);
}

export default {
    async fetch(request, env) {

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders()
            });
        }

        try {

            const url = new URL(request.url);

            /*
             * GET /products
             * Връща продуктите от GitHub
             */

            if (
                request.method === "GET" &&
                url.pathname === "/products"
            ) {

                const response =
                    await githubRequest(env);

                if (!response.ok) {

                    const error =
                        await response.text();

                    return json({
                        success: false,
                        error: "GitHub read error",
                        details: error
                    }, 500);

                }

                const data =
                    await response.json();

                if (!data.content) {
                    return json([]);
                }

                const content =
                    decodeBase64(data.content);

                let products = [];

                try {
                    products = JSON.parse(content);
                } catch {
                    products = [];
                }

                return json(products);
            }


            /*
             * PUT /products
             * Записва целия products.json
             */

            if (
                request.method === "PUT" &&
                url.pathname === "/products"
            ) {

                const adminKey =
                    request.headers.get("X-Admin-Key");

                if (
                    !env.ADMIN_API_KEY ||
                    adminKey !== env.ADMIN_API_KEY
                ) {

                    return json({
                        success: false,
                        error: "Unauthorized"
                    }, 401);

                }

                const products =
                    await request.json();

                if (!Array.isArray(products)) {

                    return json({
                        success: false,
                        error: "Products must be an array"
                    }, 400);

                }

                /*
                 * Вземаме текущия SHA на файла.
                 */

                const currentResponse =
                    await githubRequest(env);

                if (!currentResponse.ok) {

                    const error =
                        await currentResponse.text();

                    return json({
                        success: false,
                        error: "Could not read existing products.json",
                        details: error
                    }, 500);

                }

                const current =
                    await currentResponse.json();

                const newContent =
                    JSON.stringify(products, null, 2) + "\n";

                const updateBody = {
                    message:
                        `Update products.json - ${new Date().toISOString()}`,

                    content:
                        encodeBase64(newContent),

                    sha:
                        current.sha
                };

                const updateResponse =
                    await githubRequest(
                        env,
                        "PUT",
                        updateBody
                    );

                if (!updateResponse.ok) {

                    const error =
                        await updateResponse.text();

                    return json({
                        success: false,
                        error: "GitHub write error",
                        details: error
                    }, 500);

                }

                const result =
                    await updateResponse.json();

                return json({
                    success: true,
                    message: "Products saved to GitHub",
                    commit: result.commit?.sha || null
                });
            }


            /*
             * GET /health
             */

            if (
                request.method === "GET" &&
                url.pathname === "/health"
            ) {

                return json({
                    success: true,
                    service: "DRIPVAULT API",
                    status: "online"
                });

            }


            return json({
                success: false,
                error: "Not found"
            }, 404);

        } catch (error) {

            return json({
                success: false,
                error: error.message || "Server error"
            }, 500);

        }
    }
};
