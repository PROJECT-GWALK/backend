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
    "/files/{bucket}/{object}": {
      get: {
        tags: ["Files"],
        summary: "Get object from bucket",
        parameters: [
          { name: "bucket", in: "path", required: true, schema: { type: "string" } },
          { name: "object", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "File content",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" }
              }
            }
          },
          "404": { description: "File not found" }
        }
      }
    },

    "/api/user/@me": {
      get: {
        tags: ["User"],
        summary: "Get current user",
        security: [{ SessionToken: [] }],
        responses: {
          "200": {
            description: "User info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    user: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        email: { type: "string", nullable: true },
                        username: { type: "string", nullable: true },
                        name: { type: "string", nullable: true },
                        image: { type: "string", nullable: true },
                        description: { type: "string", nullable: true },
                        role: { type: "string", enum: ["USER", "ADMIN"] }
                      }
                    },
                    banned: { type: "boolean" },
                    reason: { type: "string", nullable: true }
                  }
                }
              }
            }
          }
        }
      },
      put: {
        tags: ["User"],
        summary: "Update current user",
        security: [{ SessionToken: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  username: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  image: { type: "string" },
                  file: { type: "string", format: "binary" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Updated user",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    user: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        email: { type: "string", nullable: true },
                        username: { type: "string", nullable: true },
                        name: { type: "string", nullable: true },
                        image: { type: "string", nullable: true },
                        description: { type: "string", nullable: true },
                        role: { type: "string", enum: ["USER", "ADMIN"] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/admindashboard/userdailyactive": {
      get: {
        tags: ["Admin"],
        summary: "User daily active (default current year)",
        security: [{ SessionToken: [] }],
        responses: {
          "200": {
            description: "Chart data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        year: { type: "integer" },
                        month: { type: "integer", nullable: true },
                        availableYears: { type: "array", items: { type: "integer" } },
                        chart: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: { label: { type: "string" }, count: { type: "integer" } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/admindashboard/userdailyactive/{year}": {
      get: {
        tags: ["Admin"],
        summary: "User daily active by year",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "year", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": {
            description: "Chart data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        year: { type: "integer" },
                        month: { type: "integer", nullable: true },
                        availableYears: { type: "array", items: { type: "integer" } },
                        chart: {
                          type: "array",
                          items: { type: "object", properties: { label: { type: "string" }, count: { type: "integer" } } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/admindashboard/userdailyactive/{year}/{month}": {
      get: {
        tags: ["Admin"],
        summary: "User daily active by year/month",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "year", in: "path", required: true, schema: { type: "integer" } },
          { name: "month", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": {
            description: "Chart data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        year: { type: "integer" },
                        month: { type: "integer", nullable: true },
                        availableYears: { type: "array", items: { type: "integer" } },
                        chart: {
                          type: "array",
                          items: { type: "object", properties: { label: { type: "string" }, count: { type: "integer" } } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/admindashboard/users": {
      get: {
        tags: ["Admin"],
        summary: "Total users",
        security: [{ SessionToken: [] }],
        responses: {
          "200": {
            description: "Count",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, totalUsers: { type: "integer" } } }
              }
            }
          }
        }
      }
    },

    "/api/admindashboard/events": {
      get: {
        tags: ["Admin"],
        summary: "Total events",
        security: [{ SessionToken: [] }],
        responses: {
          "200": {
            description: "Count",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, totalEvents: { type: "integer" } } }
              }
            }
          }
        }
      }
    },

    "/api/usermanagement": {
      get: {
        tags: ["Admin"],
        summary: "List users",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "role", in: "query", required: false, schema: { type: "string", enum: ["USER", "ADMIN"] } }
        ],
        responses: {
          "200": {
            description: "Users",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    users: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string", nullable: true },
                          username: { type: "string", nullable: true },
                          email: { type: "string", nullable: true },
                          role: { type: "string", enum: ["USER", "ADMIN"] },
                          createdAt: { type: "string", format: "date-time" },
                          banned: { type: "boolean" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/usermanagement/{id}/role": {
      put: {
        tags: ["Admin"],
        summary: "Update user role",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { role: { type: "string", enum: ["USER", "ADMIN"] } }, required: ["role"] }
            }
          }
        },
        responses: {
          "200": {
            description: "Role updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    user: { type: "object", properties: { id: { type: "string" }, email: { type: "string", nullable: true }, role: { type: "string", enum: ["USER", "ADMIN"] } } }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/usermanagement/{id}": {
      delete: {
        tags: ["Admin"],
        summary: "Delete user",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "User deleted",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" } } }
              }
            }
          }
        }
      }
    },

    "/api/usermanagement/{id}/ban": {
      post: {
        tags: ["Admin"],
        summary: "Ban user",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { reason: { type: "string" }, expiresAt: { type: "string", format: "date-time" } } }
            }
          }
        },
        responses: {
          "200": {
            description: "User banned",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, email: { type: "string" } } }
              }
            }
          }
        }
      }
    },

    "/api/usermanagement/{id}/unban": {
      post: {
        tags: ["Admin"],
        summary: "Unban user",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "User unbanned",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, email: { type: "string" } } }
              }
            }
          }
        }
      }
    },

    "/api/events": {
      post: {
        tags: ["Events"],
        summary: "Create event (unique name)",
        security: [{ SessionToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { eventName: { type: "string" } }, required: ["eventName"] }
            }
          }
        },
        responses: {
          "200": {
            description: "Event created",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, event: { type: "object", properties: { id: { type: "string" }, eventName: { type: "string" }, status: { type: "string", enum: ["DRAFT", "PUBLISHED"] } } } } }
              }
            }
          },
          "409": { description: "Event name already exists" }
        }
      }
    },

    "/api/events/{id}": {
      get: {
        tags: ["Events"],
        summary: "Get event (owner-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      },
      put: {
        tags: ["Events"],
        summary: "Update event (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  eventName: { type: "string" },
                  eventDescription: { type: "string" },
                  locationName: { type: "string" },
                  location: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Updated" }, "409": { description: "Event name already exists" } }
      },
      delete: {
        tags: ["Events"],
        summary: "Delete event (draft-only, leader)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" }, deletedId: { type: "string" } } } } } },
          "400": { description: "Only draft events can be deleted" }
        }
      }
    },

    "/api/events/{id}/organizers/invite": {
      post: {
        tags: ["Events"],
        summary: "Invite organizer (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } } }
        },
        responses: {
          "200": { description: "Invite URL generated", content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" }, inviteUrl: { type: "string" } } } } } },
          "404": { description: "User not found" }
        }
      }
    },

    "/api/events/invites/accept": {
      get: {
        tags: ["Events"],
        summary: "Accept organizer invite",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "token", in: "query", required: true, schema: { type: "string" } } ],
        responses: { "200": { description: "Joined" }, "400": { description: "Invalid/expired token" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/events/{id}/publicview": {
      put: {
        tags: ["Events"],
        summary: "Toggle publicView (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { publicView: { type: "boolean" } }, required: ["publicView"] } } } },
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/events/{id}/submit": {
      post: {
        tags: ["Events"],
        summary: "Publish event (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { publicView: { type: "boolean" } } } } } },
        responses: { "200": { description: "Published" }, "400": { description: "Event incomplete" } }
      }
    },

  },
};
