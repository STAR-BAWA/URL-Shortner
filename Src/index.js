import sql from "./db.js";
import redis from "./redis.js";


async function isRateLimited(ip) {

  const key = `rate_limit:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }

  return count > 5
}

//get remaining time for rate limit 
async function getRetryAfter(ip) {
  const key = "rate_limit:" + ip;
  const ttl = await redis.ttl(key);
  return ttl;

}

// ==========================================
// Generate a random shortcode
// ==========================================

function generateCode() {
  return Math.random()
    .toString(36)
    .substring(2, 8);
}


// ==========================================
// Generate a unique shortcode
// ==========================================

async function generateUniqueCode() {

  while (true) {

    const shortcode = generateCode();

    const existing = await sql`
      SELECT id
      FROM urls
      WHERE shortcode = ${shortcode}
    `;

    if (existing.length === 0) {
      return shortcode;
    }
  }
}


// ==========================================
// Start Bun server
// ==========================================

const server = Bun.serve({

  port: 3000,

  async fetch(request) {

    const url = new URL(request.url);


    // ==========================================
    // GET /
    // ==========================================

    // Rate limiting

    if (
      url.pathname === "/" &&
      request.method === "GET"
    ) {

      return new Response(
        "URL Shortener is running!"
      );

    }


    // ==========================================
    // POST /shorten
    // ==========================================

    if (
      url.pathname === "/shorten" &&
      request.method === "POST"
    ) {


      const ip = request.headers.get("x-forwarded-for") || request.headers.get("remote-addr") || "unknown";

      if (await isRateLimited(ip)) {

        const retryAfter = await getRetryAfter(ip);
        return new Response(

          {
            error: "Too many requests. Please try again later."
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(retryAfter)
            }
          }
        );
      }


      try {

        // ------------------------------------------
        // Read JSON body
        // ------------------------------------------

        const body = await request.json();

        const originalUrl = body.url;
        const customCode = body.customCode;
        const expiresIn = body.expiresIn;


        // ------------------------------------------
        // Calculate expiration
        // ------------------------------------------

        let expiresAt = null;

        if (
          expiresIn !== undefined &&
          expiresIn !== null
        ) {

          if (
            typeof expiresIn !== "number" ||
            expiresIn <= 0
          ) {

            return Response.json(
              {
                error: "expiresIn must be a positive number"
              },
              {
                status: 400
              }
            );

          }

          expiresAt = new Date(
            Date.now() + expiresIn * 1000
          );

        }


        // ------------------------------------------
        // Check URL exists
        // ------------------------------------------

        if (!originalUrl) {

          return Response.json(
            {
              error: "URL is required"
            },
            {
              status: 400
            }
          );

        }


        // ------------------------------------------
        // Validate URL
        // ------------------------------------------

        try {

          new URL(originalUrl);

        } catch {

          return Response.json(
            {
              error: "Invalid URL"
            },
            {
              status: 400
            }
          );

        }


        // ------------------------------------------
        // Validate custom code
        // ------------------------------------------

        if (customCode) {

          // Maximum 10 characters
          if (customCode.length > 10) {

            return Response.json(
              {
                error:
                  "Custom code must be 10 characters or less"
              },
              {
                status: 400
              }
            );

          }


          // Only letters, numbers,
          // hyphen and underscore
          if (!/^[a-zA-Z0-9_-]+$/.test(customCode)) {

            return Response.json(
              {
                error:
                  "Custom code can only contain letters, numbers, hyphens and underscores"
              },
              {
                status: 400
              }
            );

          }

        }


        // ------------------------------------------
        // Generate / choose shortcode
        // ------------------------------------------

        let shortcode;


        if (customCode) {

          // Use custom shortcode
          shortcode = customCode;


          // Check if custom shortcode already exists
          const existing = await sql`
            SELECT id
            FROM urls
            WHERE shortcode = ${customCode}
          `;


          if (existing.length > 0) {

            return Response.json(
              {
                error:
                  "Custom shortcode already exists"
              },
              {
                status: 409
              }
            );

          }

        } else {

          // Generate random shortcode
          shortcode =
            await generateUniqueCode();

        }


        // ------------------------------------------
        // Save URL to PostgreSQL
        // ------------------------------------------

        await sql`

          INSERT INTO urls (
            shortcode,
            original_url,
            expires_at,
            click_count
          )

          VALUES (
            ${shortcode},
            ${originalUrl},
            ${expiresAt},
            0
          )

        `;


        // ------------------------------------------
        // Log
        // ------------------------------------------

        console.log(
          `Saved: ${shortcode} → ${originalUrl}${expiresAt
            ? ` (expires at ${expiresAt})`
            : ""
          }`
        );


        // ------------------------------------------
        // Return response
        // ------------------------------------------

        return Response.json({

          shortcode,

          shortUrl:
            `http://localhost:3000/${shortcode}`

        });


      } catch (error) {

        console.error("ERROR:", error);

        return Response.json(
          {
            error:
              "Something went wrong: " +
              error.message
          },
          {
            status: 500
          }
        );

      }

    }


    // ==========================================
    // GET /stats/:shortcode
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/stats/")
    ) {

      // Remove "/stats/" from pathname
      const shortcode =
        url.pathname.substring(7);


      // ------------------------------------------
      // Check shortcode exists
      // ------------------------------------------

      if (!shortcode) {

        return Response.json(
          {
            error: "Shortcode is required"
          },
          {
            status: 400
          }
        );

      }


      try {

        // ------------------------------------------
        // Get statistics
        // ------------------------------------------

        const result = await sql`

          SELECT
            shortcode,
            original_url,
            expires_at,
            click_count

          FROM urls

          WHERE shortcode = ${shortcode}

        `;


        // ------------------------------------------
        // Shortcode doesn't exist
        // ------------------------------------------

        if (result.length === 0) {

          return Response.json(
            {
              error: "Short URL not found"
            },
            {
              status: 404
            }
          );

        }


        // ------------------------------------------
        // Return statistics
        // ------------------------------------------

        return Response.json({

          shortcode:
            result[0].shortcode,

          originalUrl:
            result[0].original_url,

          clickCount:
            result[0].click_count,

          expiresAt:
            result[0].expires_at

        });


      } catch (error) {

        console.error("ERROR:", error);

        return Response.json(
          {
            error: "Internal Server Error"
          },
          {
            status: 500
          }
        );

      }

    }


    // ==========================================
    // GET /:shortcode
    // ==========================================

    if (request.method === "GET") {

      // Remove "/" from pathname
      const shortcode =
        url.pathname.substring(1);


      // ------------------------------------------
      // Check shortcode exists
      // ------------------------------------------

      if (!shortcode) {

        return new Response(
          "Shortcode is required",
          {
            status: 400
          }
        );

      }


      try {

        // ------------------------------------------
        // Find URL, expiration and click count
        // ------------------------------------------

        const result = await sql`

          SELECT
            shortcode,
            original_url,
            expires_at,
            click_count

          FROM urls

          WHERE shortcode = ${shortcode}

        `;


        // ------------------------------------------
        // Shortcode doesn't exist
        // ------------------------------------------

        if (result.length === 0) {

          return Response.json(
            {
              error: "Short URL not found"
            },
            {
              status: 404
            }
          );

        }


        // ------------------------------------------
        // Get values
        // ------------------------------------------

        const originalUrl =
          result[0].original_url;

        const expiresAt =
          result[0].expires_at;


        // ------------------------------------------
        // Check expiration
        // ------------------------------------------

        if (
          expiresAt &&
          new Date() > new Date(expiresAt)
        ) {

          return new Response(
            "This short URL has expired",
            {
              status: 410
            }
          );

        }


        // ------------------------------------------
        // Increase click count
        // ------------------------------------------

        await sql`

          UPDATE urls

          SET click_count = click_count + 1

          WHERE shortcode = ${shortcode}

        `;


        // ------------------------------------------
        // Redirect
        // ------------------------------------------

        return Response.redirect(
          originalUrl,
          302
        );


      } catch (error) {

        console.error("ERROR:", error);

        return new Response(
          "Internal Server Error",
          {
            status: 500
          }
        );

      }

    }


    // ==========================================
    // Everything else
    // ==========================================

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );

  }

});


// ==========================================
// Server started
// ==========================================

console.log(
  `Server running on http://localhost:${server.port}`
);