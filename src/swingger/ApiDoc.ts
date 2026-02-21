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
    "/api/health/db": {
      get: {
        tags: ["Health"],
        summary: "Check database connectivity",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    database: { type: "string" },
                    latencyMs: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { description: "Database connection failed" },
        },
      },
    },
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

    "/api/user": {
      get: {
        tags: ["User"],
        summary: "List users (public profiles)",
        parameters: [
          { name: "q", in: "query", required: false, schema: { type: "string" } },
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "sort", in: "query", required: false, schema: { type: "string", enum: ["latest", "most_active", "name"] } }
        ],
        responses: {
          "200": { description: "OK" }
        }
      }
    },

    "/api/user/{username}": {
      get: {
        tags: ["User"],
        summary: "Get user profile by username",
        parameters: [
          { name: "username", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": { description: "OK" },
          "404": { description: "User not found" }
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
      get: {
        tags: ["Events"],
        summary: "List published events (auth optional)",
        responses: { "200": { description: "OK" } }
      },
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
        responses: { "200": { description: "Event created" }, "409": { description: "Event name already exists" } }
      }
    },

    "/api/events/{id}": {
      get: {
        tags: ["Events"],
        summary: "Get event (access depends on status/publicView)",
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
                  location: { type: "string" },
                  publicView: { type: "boolean" },
                  startView: { type: "string", format: "date-time" },
                  endView: { type: "string", format: "date-time" },
                  startJoinDate: { type: "string", format: "date-time" },
                  endJoinDate: { type: "string", format: "date-time" },
                  maxTeamMembers: { type: "number" },
                  maxTeams: { type: "number" },
                  virtualRewardGuest: { type: "number" },
                  virtualRewardCommittee: { type: "number" },
                  hasCommittee: { type: "boolean" },
                  imageCover: { type: "string" }
                }
              }
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  eventName: { type: "string" },
                  eventDescription: { type: "string" },
                  locationName: { type: "string" },
                  location: { type: "string" },
                  publicView: { type: "string" },
                  hasCommittee: { type: "string" },
                  currentStep: { type: "string" },
                  startView: { type: "string", format: "date-time" },
                  endView: { type: "string", format: "date-time" },
                  startJoinDate: { type: "string", format: "date-time" },
                  endJoinDate: { type: "string", format: "date-time" },
                  maxTeamMembers: { type: "string" },
                  maxTeams: { type: "string" },
                  virtualRewardGuest: { type: "string" },
                  virtualRewardCommittee: { type: "string" },
                  imageCover: { type: "string" },
                  file: { type: "string", format: "binary" }
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
        responses: { "200": { description: "Deleted" }, "400": { description: "Only draft events can be deleted" } }
      }
    },

    "/api/events/{id}/public-view": {
      put: {
        tags: ["Events"],
        summary: "Toggle publicView (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { publicView: { type: "boolean" } }, required: ["publicView"] } } } },
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/events/{id}/publish": {
      post: {
        tags: ["Events"],
        summary: "Publish event (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { publicView: { type: "boolean" } } } } } },
        responses: { "200": { description: "Published" }, "400": { description: "Event incomplete" } }
      }
    },

    "/api/events/me/drafts": {
      get: {
        tags: ["Events"],
        summary: "My draft events",
        security: [{ SessionToken: [] }],
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/events/me": {
      get: {
        tags: ["Events"],
        summary: "My events (non-draft)",
        security: [{ SessionToken: [] }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    events: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          eventName: { type: "string" },
                          status: { type: "string" },
                          createdAt: { type: "string", format: "date-time" },
                          imageCover: { type: "string", nullable: true },
                          role: { type: "string", nullable: true },
                          isLeader: { type: "boolean" }
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

    "/api/events/check-name": {
      get: {
        tags: ["Events"],
        summary: "Check event name availability",
        parameters: [ { name: "eventName", in: "query", required: true, schema: { type: "string" } } ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, available: { type: "boolean" } } }
              }
            }
          },
          "400": { description: "eventName is required" }
        }
      }
    },

    "/api/events/me/history": {
      get: {
        tags: ["Events"],
        summary: "My event history",
        security: [{ SessionToken: [] }],
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/events/user/{username}/history": {
      get: {
        tags: ["Events"],
        summary: "User event history (auth optional)",
        parameters: [
          { name: "username", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "User not found" } }
      }
    },

    "/api/events/{id}/presenter/stats": {
      get: {
        tags: ["Events"],
        summary: "Presenter stats in event",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/rankings": {
      get: {
        tags: ["Events"],
        summary: "Event rankings",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/invite/sign": {
      get: {
        tags: ["Events"],
        summary: "Create invite signature",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "role", in: "query", required: true, schema: { type: "string", enum: ["presenter", "guest", "committee"] } }
        ],
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "401": { description: "Unauthorized" }, "404": { description: "Event not found" } }
      }
    },

    "/api/events/{id}/invite/token": {
      get: {
        tags: ["Events"],
        summary: "Get invite token by role",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "role", in: "query", required: true, schema: { type: "string", enum: ["presenter", "guest", "committee"] } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Event not found" } }
      }
    },

    "/api/events/{id}/invite/token/refresh": {
      post: {
        tags: ["Events"],
        summary: "Refresh invite token by role (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "role", in: "query", required: true, schema: { type: "string", enum: ["presenter", "guest", "committee"] } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Event not found" } }
      }
    },

    "/api/events/{id}/invite/preview": {
      get: {
        tags: ["Events"],
        summary: "Preview invite token/role",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "token", in: "query", required: false, schema: { type: "string" } },
          { name: "role", in: "query", required: false, schema: { type: "string", enum: ["presenter", "guest", "committee"] } }
        ],
        responses: { "200": { description: "OK" }, "400": { description: "Invalid token/role" }, "404": { description: "Event not found" } }
      }
    },

    "/api/events/{id}/invite": {
      post: {
        tags: ["Events"],
        summary: "Join event via invite",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "token", in: "query", required: false, schema: { type: "string" } },
          { name: "role", in: "query", required: false, schema: { type: "string", enum: ["presenter", "guest", "committee"] } },
          { name: "sig", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "400": { description: "Invalid invite" }, "401": { description: "Unauthorized" }, "404": { description: "Event not found" } }
      }
    },

    "/api/events/{id}/participants": {
      get: {
        tags: ["Events"],
        summary: "List participants (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/participants/{pid}": {
      put: {
        tags: ["Events"],
        summary: "Update participant (organizer leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "pid", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      },
      delete: {
        tags: ["Events"],
        summary: "Remove participant (organizer leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "pid", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/teams": {
      get: {
        tags: ["Events"],
        summary: "List teams",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      },
      post: {
        tags: ["Events"],
        summary: "Create team (presenter-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/teams/{teamId}": {
      get: {
        tags: ["Events"],
        summary: "Get team",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      },
      put: {
        tags: ["Events"],
        summary: "Update team (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      },
      delete: {
        tags: ["Events"],
        summary: "Delete team (leader or organizer)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/presenters/candidates": {
      get: {
        tags: ["Events"],
        summary: "Search presenter candidates",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "q", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/events/{id}/teams/{teamId}/members": {
      post: {
        tags: ["Events"],
        summary: "Add team member (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { userId: { type: "string" } }, required: ["userId"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/teams/{teamId}/members/{userId}": {
      delete: {
        tags: ["Events"],
        summary: "Remove team member (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/teams/{teamId}/comments": {
      get: {
        tags: ["Events"],
        summary: "Get comments for a team",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/teams/{teamId}/files": {
      post: {
        tags: ["Events"],
        summary: "Upload team file or URL",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  fileTypeId: { type: "string" },
                  url: { type: "string" },
                  file: { type: "string", format: "binary" }
                },
                required: ["fileTypeId"]
              }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/teams/{teamId}/files/{fileTypeId}": {
      delete: {
        tags: ["Events"],
        summary: "Delete team file by fileTypeId",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } },
          { name: "fileTypeId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{eventId}/action/give-vr": {
      put: {
        tags: ["EventsAction"],
        summary: "Give VR to a project",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { projectId: { type: "string" }, amount: { type: "integer" } }, required: ["projectId", "amount"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{eventId}/action/reset-vr": {
      post: {
        tags: ["EventsAction"],
        summary: "Reset VR for a project",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/events/{eventId}/action/give-special": {
      put: {
        tags: ["EventsAction"],
        summary: "Give special rewards to a project",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { projectId: { type: "string" }, rewardIds: { type: "array", items: { type: "string" } } }, required: ["projectId", "rewardIds"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/events/{eventId}/action/reset-special": {
      post: {
        tags: ["EventsAction"],
        summary: "Reset special rewards for a project",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/events/{eventId}/action/give-comment": {
      post: {
        tags: ["EventsAction"],
        summary: "Give comment to a project",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { projectId: { type: "string" }, content: { type: "string" } }, required: ["projectId", "content"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/events/{eventId}/action/rate": {
      put: {
        tags: ["EventsAction"],
        summary: "Rate event",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { rating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string" } }, required: ["rating"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" }, "403": { description: "Forbidden" } }
      },
      get: {
        tags: ["EventsAction"],
        summary: "Get my event rating",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "400": { description: "Bad request" } }
      }
    },

    "/api/events/{eventId}/action/ratings": {
      get: {
        tags: ["EventsAction"],
        summary: "Get all event ratings (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/evaluation/event/{eventId}/criteria": {
      get: {
        tags: ["Evaluation"],
        summary: "Get evaluation criteria for event",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      },
      post: {
        tags: ["Evaluation"],
        summary: "Create evaluation criteria (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, maxScore: { type: "number" }, weightPercentage: { type: "number" }, sortOrder: { type: "integer" } }, required: ["name", "maxScore", "weightPercentage"] }
            }
          }
        },
        responses: { "201": { description: "Created" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/evaluation/event/{eventId}/criteria/{criteriaId}": {
      put: {
        tags: ["Evaluation"],
        summary: "Update evaluation criteria (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "criteriaId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      },
      delete: {
        tags: ["Evaluation"],
        summary: "Delete evaluation criteria (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "criteriaId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/evaluation/event/{eventId}/team/{teamId}/grade": {
      post: {
        tags: ["Evaluation"],
        summary: "Submit grade (committee-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { criteriaId: { type: "string" }, score: { type: "number" } }, required: ["criteriaId", "score"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } }
      }
    },

    "/api/evaluation/event/{eventId}/team/{teamId}/grades": {
      get: {
        tags: ["Evaluation"],
        summary: "Get my grades (committee-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/evaluation/event/{eventId}/results": {
      get: {
        tags: ["Evaluation"],
        summary: "Get evaluation results (organizer-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/evaluation/event/{eventId}/team/{teamId}/status": {
      get: {
        tags: ["Evaluation"],
        summary: "Get grading status (committee-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "403": { description: "Forbidden" } }
      }
    },

    "/api/admindashboard/events/list": {
      get: {
        tags: ["Admin"],
        summary: "List events (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "q", in: "query", required: false, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["DRAFT", "PUBLISHED"] } },
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
        ],
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/admindashboard/events/{eventId}": {
      get: {
        tags: ["Admin"],
        summary: "Get event details (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Event not found" } }
      },
      put: {
        tags: ["Admin"],
        summary: "Update event (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Event not found" } }
      },
      delete: {
        tags: ["Admin"],
        summary: "Delete event (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Event not found" } }
      }
    },

    "/api/admindashboard/events/{eventId}/participants/{pid}": {
      put: {
        tags: ["Admin"],
        summary: "Update participant (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "pid", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      },
      delete: {
        tags: ["Admin"],
        summary: "Remove participant (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "pid", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      }
    },

    "/api/admindashboard/events/{eventId}/teams/{teamId}": {
      put: {
        tags: ["Admin"],
        summary: "Update team (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      },
      delete: {
        tags: ["Admin"],
        summary: "Delete team (admin)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "eventId", in: "path", required: true, schema: { type: "string" } },
          { name: "teamId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      }
    },

    "/api/events/{id}/special-rewards": {
      post: {
        tags: ["Events"],
        summary: "Create special reward (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [ { name: "id", in: "path", required: true, schema: { type: "string" } } ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  image: { type: "string" },
                  file: { type: "string", format: "binary" }
                },
                required: ["name"]
              }
            },
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  image: { type: "string" }
                },
                required: ["name"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Reward created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    reward: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        eventId: { type: "string" },
                        name: { type: "string" },
                        description: { type: "string", nullable: true },
                        image: { type: "string", nullable: true }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { description: "Reward name is required" },
          "403": { description: "Forbidden" },
          "404": { description: "Event not found" }
        }
      }
    },

    "/api/events/{id}/special-rewards/{rewardId}": {
      put: {
        tags: ["Events"],
        summary: "Update special reward (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "rewardId", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  image: { type: "string" },
                  file: { type: "string", format: "binary" }
                }
              }
            },
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  image: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Reward updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    reward: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        eventId: { type: "string" },
                        name: { type: "string" },
                        description: { type: "string", nullable: true },
                        image: { type: "string", nullable: true }
                      }
                    }
                  }
                }
              }
            }
          },
          "403": { description: "Forbidden" },
          "404": { description: "Reward not found" }
        }
      },
      delete: {
        tags: ["Events"],
        summary: "Delete special reward (leader-only)",
        security: [{ SessionToken: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "rewardId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Reward deleted",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message: { type: "string" }, deletedId: { type: "string" } } }
              }
            }
          },
          "403": { description: "Forbidden" },
          "404": { description: "Reward not found" }
        }
      }
    },
  },
};
