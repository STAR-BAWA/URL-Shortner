import sql from "./db.js";


// Generate a random shortcode
function generateCode() {
  return Math.random()
    .toString(36)
    .substring(2, 8);
}


// Generate a shortcode that doesn't already exist
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


const server = Bun.serve({
  port: 3000,

  async fetch(request) {

    const url = new URL(request.url);


    // ==========================================
    // GET /
    // ==========================================

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

      try {

        // Read JSON body
        const body = await request.json();

        const originalUrl = body.url;
        const customCode = body.customCode;


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
                error: "Custom code must be 10 characters or less"
              },
              {
                status: 400
              }
            );

          }


          // Only allow letters, numbers, hyphen and underscore
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

          // User provided custom code
          shortcode = customCode;


          // Check if it already exists
          const existing = await sql`
            SELECT id
            FROM urls
            WHERE shortcode = ${customCode}
          `;


          if (existing.length > 0) {

            return Response.json(
              {
                error: "Custom shortcode already exists"
              },
              {
                status: 409
              }
            );

          }

        } else {

          // Generate random shortcode
          shortcode = await generateUniqueCode();

        }


        // ------------------------------------------
        // Save URL to PostgreSQL
        // ------------------------------------------

        await sql`
          INSERT INTO urls (
            shortcode,
            original_url
          )
          VALUES (
            ${shortcode},
            ${originalUrl}
          )
        `;


        console.log(
          `Saved: ${shortcode} → ${originalUrl}`
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

        console.error(error);

        return Response.json(
          {
            error: "Something went wrong"
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


      // Make sure shortcode exists
      if (!shortcode) {

        return new Response(
          "Shortcode is required",
          {
            status: 400
          }
        );

      }


      try {

        // Find original URL
        const result = await sql`
          SELECT original_url
          FROM urls
          WHERE shortcode = ${shortcode}
        `;


        // Shortcode doesn't exist
        if (result.length === 0) {

          return new Response(
            "Short URL not found",
            {
              status: 404
            }
          );

        }


        // Get original URL
        const originalUrl =
          result[0].original_url;


        // Redirect
        return Response.redirect(
          originalUrl,
          302
        );


      } catch (error) {

        console.error(error);

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


console.log(
  `Server running on http://localhost:${server.port}`
);