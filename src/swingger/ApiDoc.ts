export const openApiDoc = {
  openapi: "3.0.0",
  info: {
    title: "API Documentation",
    version: "1.0.0",
    description: "API documentation for your service",
  },
  components: {
    securitySchemes: {
      SessionToken: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
      },
    },
  },

  paths: {
    //////////////////////////////////////////////////////////
    // USER
    //////////////////////////////////////////////////////////

    // Files Route (generic placeholder)
    "/files": {
      get: {
        tags: ["Files"],
        summary: "Get file list or file info",
        responses: {
          "200": { description: "Success" },
        },
      },
    },

    // /api/user/@me
    "/api/user/@me": {
      get: {
        tags: ["User"],
        summary: "Get current user info",
        responses: {
          "200": { description: "User info returned" },
        },
      },
    },

    //////////////////////////////////////////////////////////
    // ADMIN
    //////////////////////////////////////////////////////////

    // /api/usermanagement
    "/api/usermanagement": {
      get: {
        tags: ["Admin"],
        summary: "Admin: Get user list",
        responses: {
          "200": { description: "User list returned" },
        },
      },
      post: {
        tags: ["Admin"],
        summary: "Admin: Create or manage user",
        responses: {
          "201": { description: "User created/updated" },
        },
      },
    },

    // /api/admindashboard
    "/api/admindashboard": {
      get: {
        tags: ["Admin"],
        summary: "Admin dashboard summary",
        responses: {
          "200": { description: "Dashboard data returned" },
        },
      },
      post: {
        tags: ["Admin"],
        summary: "Admin dashboard data update",
        responses: {
          "200": { description: "Dashboard data updated" },
        },
      },
    },
  },
};
