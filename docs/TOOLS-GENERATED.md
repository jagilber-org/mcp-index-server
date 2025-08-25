# Generated Tool Registry

Registry Version: 2025-08-01

| Method | Stable | Mutation | Description |
|--------|--------|----------|-------------|
| gates/evaluate | yes |  | Evaluate configured gating criteria over current catalog. |
| health/check | yes |  | Returns server health status & version. |
| instructions/diff | yes |  | Incremental diff of catalog relative to client known state/hash. |
| instructions/export | yes |  | Export full instruction catalog, optionally subset by ids. |
| instructions/get | yes |  | Fetch a single instruction entry by id. |
| instructions/import |  | yes | Import (create/overwrite) instruction entries from provided objects. |
| instructions/list | yes |  | List all instruction entries (optionally filtered by category). |
| instructions/reload |  | yes | Force reload of instruction catalog from disk. |
| instructions/repair |  | yes | Repair out-of-sync sourceHash fields (noop if none drifted). |
| instructions/search | yes |  | Search instructions by text query across title & body. |
| integrity/verify | yes |  | Verify each instruction body hash against stored sourceHash. |
| meta/tools | yes |  | Enumerate available tools & their metadata. |
| metrics/snapshot | yes |  | Performance metrics summary for handled methods. |
| prompt/review | yes |  | Static analysis of a prompt returning issues & summary. |
| usage/flush |  | yes | Flush usage snapshot to persistent storage. |
| usage/hotset | yes |  | Return the most-used instruction entries (hot set). |
| usage/track | yes |  | Increment usage counters & timestamps for an instruction id. |

## Schemas
### gates/evaluate
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "notConfigured"
      ],
      "properties": {
        "notConfigured": {
          "const": true
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "generatedAt",
        "results",
        "summary"
      ],
      "additionalProperties": false,
      "properties": {
        "generatedAt": {
          "type": "string"
        },
        "results": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "passed",
              "count",
              "op",
              "value",
              "severity"
            ],
            "additionalProperties": true,
            "properties": {
              "id": {
                "type": "string"
              },
              "passed": {
                "type": "boolean"
              },
              "count": {
                "type": "number"
              },
              "op": {
                "type": "string"
              },
              "value": {
                "type": "number"
              },
              "severity": {
                "type": "string"
              },
              "description": {
                "type": "string"
              }
            }
          }
        },
        "summary": {
          "type": "object",
          "required": [
            "errors",
            "warnings",
            "total"
          ],
          "properties": {
            "errors": {
              "type": "number"
            },
            "warnings": {
              "type": "number"
            },
            "total": {
              "type": "number"
            }
          },
          "additionalProperties": false
        }
      }
    }
  ]
}
```

### health/check
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "status",
    "timestamp",
    "version"
  ],
  "properties": {
    "status": {
      "const": "ok"
    },
    "timestamp": {
      "type": "string"
    },
    "version": {
      "type": "string"
    }
  }
}
```

### instructions/diff
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "clientHash": {
      "type": "string"
    },
    "known": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "sourceHash"
        ],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "sourceHash": {
            "type": "string"
          }
        }
      }
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "upToDate",
        "hash"
      ],
      "additionalProperties": false,
      "properties": {
        "upToDate": {
          "const": true
        },
        "hash": {
          "type": "string"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "hash",
        "added",
        "updated",
        "removed"
      ],
      "additionalProperties": false,
      "properties": {
        "hash": {
          "type": "string"
        },
        "added": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "title",
              "body",
              "priority",
              "audience",
              "requirement",
              "categories",
              "sourceHash",
              "schemaVersion",
              "createdAt",
              "updatedAt"
            ],
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1
              },
              "title": {
                "type": "string"
              },
              "body": {
                "type": "string"
              },
              "rationale": {
                "type": "string"
              },
              "priority": {
                "type": "number"
              },
              "audience": {
                "enum": [
                  "individual",
                  "group",
                  "all"
                ]
              },
              "requirement": {
                "enum": [
                  "mandatory",
                  "critical",
                  "recommended",
                  "optional",
                  "deprecated"
                ]
              },
              "categories": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "sourceHash": {
                "type": "string"
              },
              "schemaVersion": {
                "type": "string"
              },
              "deprecatedBy": {
                "type": "string"
              },
              "createdAt": {
                "type": "string"
              },
              "updatedAt": {
                "type": "string"
              },
              "usageCount": {
                "type": "number"
              },
              "lastUsedAt": {
                "type": "string"
              },
              "riskScore": {
                "type": "number"
              }
            }
          }
        },
        "updated": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "title",
              "body",
              "priority",
              "audience",
              "requirement",
              "categories",
              "sourceHash",
              "schemaVersion",
              "createdAt",
              "updatedAt"
            ],
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1
              },
              "title": {
                "type": "string"
              },
              "body": {
                "type": "string"
              },
              "rationale": {
                "type": "string"
              },
              "priority": {
                "type": "number"
              },
              "audience": {
                "enum": [
                  "individual",
                  "group",
                  "all"
                ]
              },
              "requirement": {
                "enum": [
                  "mandatory",
                  "critical",
                  "recommended",
                  "optional",
                  "deprecated"
                ]
              },
              "categories": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "sourceHash": {
                "type": "string"
              },
              "schemaVersion": {
                "type": "string"
              },
              "deprecatedBy": {
                "type": "string"
              },
              "createdAt": {
                "type": "string"
              },
              "updatedAt": {
                "type": "string"
              },
              "usageCount": {
                "type": "number"
              },
              "lastUsedAt": {
                "type": "string"
              },
              "riskScore": {
                "type": "number"
              }
            }
          }
        },
        "removed": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    {
      "type": "object",
      "required": [
        "hash",
        "changed"
      ],
      "additionalProperties": false,
      "properties": {
        "hash": {
          "type": "string"
        },
        "changed": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "title",
              "body",
              "priority",
              "audience",
              "requirement",
              "categories",
              "sourceHash",
              "schemaVersion",
              "createdAt",
              "updatedAt"
            ],
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1
              },
              "title": {
                "type": "string"
              },
              "body": {
                "type": "string"
              },
              "rationale": {
                "type": "string"
              },
              "priority": {
                "type": "number"
              },
              "audience": {
                "enum": [
                  "individual",
                  "group",
                  "all"
                ]
              },
              "requirement": {
                "enum": [
                  "mandatory",
                  "critical",
                  "recommended",
                  "optional",
                  "deprecated"
                ]
              },
              "categories": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "sourceHash": {
                "type": "string"
              },
              "schemaVersion": {
                "type": "string"
              },
              "deprecatedBy": {
                "type": "string"
              },
              "createdAt": {
                "type": "string"
              },
              "updatedAt": {
                "type": "string"
              },
              "usageCount": {
                "type": "number"
              },
              "lastUsedAt": {
                "type": "string"
              },
              "riskScore": {
                "type": "number"
              }
            }
          }
        }
      }
    }
  ]
}
```

### instructions/export
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "metaOnly": {
      "type": "boolean"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "items"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number",
      "minimum": 0
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "title",
          "body",
          "priority",
          "audience",
          "requirement",
          "categories",
          "sourceHash",
          "schemaVersion",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "title": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "rationale": {
            "type": "string"
          },
          "priority": {
            "type": "number"
          },
          "audience": {
            "enum": [
              "individual",
              "group",
              "all"
            ]
          },
          "requirement": {
            "enum": [
              "mandatory",
              "critical",
              "recommended",
              "optional",
              "deprecated"
            ]
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "sourceHash": {
            "type": "string"
          },
          "schemaVersion": {
            "type": "string"
          },
          "deprecatedBy": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "updatedAt": {
            "type": "string"
          },
          "usageCount": {
            "type": "number"
          },
          "lastUsedAt": {
            "type": "string"
          },
          "riskScore": {
            "type": "number"
          }
        }
      }
    }
  }
}
```

### instructions/get
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "notFound"
      ],
      "properties": {
        "notFound": {
          "const": true
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "hash",
        "item"
      ],
      "properties": {
        "hash": {
          "type": "string"
        },
        "item": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id",
            "title",
            "body",
            "priority",
            "audience",
            "requirement",
            "categories",
            "sourceHash",
            "schemaVersion",
            "createdAt",
            "updatedAt"
          ],
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "title": {
              "type": "string"
            },
            "body": {
              "type": "string"
            },
            "rationale": {
              "type": "string"
            },
            "priority": {
              "type": "number"
            },
            "audience": {
              "enum": [
                "individual",
                "group",
                "all"
              ]
            },
            "requirement": {
              "enum": [
                "mandatory",
                "critical",
                "recommended",
                "optional",
                "deprecated"
              ]
            },
            "categories": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "sourceHash": {
              "type": "string"
            },
            "schemaVersion": {
              "type": "string"
            },
            "deprecatedBy": {
              "type": "string"
            },
            "createdAt": {
              "type": "string"
            },
            "updatedAt": {
              "type": "string"
            },
            "usageCount": {
              "type": "number"
            },
            "lastUsedAt": {
              "type": "string"
            },
            "riskScore": {
              "type": "number"
            }
          }
        }
      }
    }
  ]
}
```

### instructions/import
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "entries"
  ],
  "properties": {
    "entries": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "id",
          "title",
          "body",
          "priority",
          "audience",
          "requirement"
        ],
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "rationale": {
            "type": "string"
          },
          "priority": {
            "type": "number"
          },
          "audience": {
            "type": "string"
          },
          "requirement": {
            "type": "string"
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "mode": {
            "type": "string"
          }
        }
      }
    },
    "mode": {
      "enum": [
        "skip",
        "overwrite"
      ]
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "hash",
        "imported",
        "skipped",
        "overwritten",
        "errors",
        "total"
      ],
      "additionalProperties": false,
      "properties": {
        "hash": {
          "type": "string"
        },
        "imported": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        },
        "overwritten": {
          "type": "number"
        },
        "total": {
          "type": "number"
        },
        "errors": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "error"
            ],
            "properties": {
              "id": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        }
      }
    }
  ]
}
```

### instructions/list
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "category": {
      "type": "string"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "items"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number",
      "minimum": 0
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "title",
          "body",
          "priority",
          "audience",
          "requirement",
          "categories",
          "sourceHash",
          "schemaVersion",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "title": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "rationale": {
            "type": "string"
          },
          "priority": {
            "type": "number"
          },
          "audience": {
            "enum": [
              "individual",
              "group",
              "all"
            ]
          },
          "requirement": {
            "enum": [
              "mandatory",
              "critical",
              "recommended",
              "optional",
              "deprecated"
            ]
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "sourceHash": {
            "type": "string"
          },
          "schemaVersion": {
            "type": "string"
          },
          "deprecatedBy": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "updatedAt": {
            "type": "string"
          },
          "usageCount": {
            "type": "number"
          },
          "lastUsedAt": {
            "type": "string"
          },
          "riskScore": {
            "type": "number"
          }
        }
      }
    }
  }
}
```

### instructions/reload
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "reloaded",
    "hash",
    "count"
  ],
  "additionalProperties": false,
  "properties": {
    "reloaded": {
      "const": true
    },
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number"
    }
  }
}
```

### instructions/repair
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "repaired",
    "updated"
  ],
  "additionalProperties": false,
  "properties": {
    "repaired": {
      "type": "number"
    },
    "updated": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### instructions/search
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "q"
  ],
  "properties": {
    "q": {
      "type": "string"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "items"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number",
      "minimum": 0
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "title",
          "body",
          "priority",
          "audience",
          "requirement",
          "categories",
          "sourceHash",
          "schemaVersion",
          "createdAt",
          "updatedAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "title": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "rationale": {
            "type": "string"
          },
          "priority": {
            "type": "number"
          },
          "audience": {
            "enum": [
              "individual",
              "group",
              "all"
            ]
          },
          "requirement": {
            "enum": [
              "mandatory",
              "critical",
              "recommended",
              "optional",
              "deprecated"
            ]
          },
          "categories": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "sourceHash": {
            "type": "string"
          },
          "schemaVersion": {
            "type": "string"
          },
          "deprecatedBy": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "updatedAt": {
            "type": "string"
          },
          "usageCount": {
            "type": "number"
          },
          "lastUsedAt": {
            "type": "string"
          },
          "riskScore": {
            "type": "number"
          }
        }
      }
    }
  }
}
```

### integrity/verify
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "issues",
    "issueCount"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number"
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "expected",
          "actual"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "expected": {
            "type": "string"
          },
          "actual": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "issueCount": {
      "type": "number"
    }
  }
}
```

### meta/tools
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": true,
  "required": [
    "stable",
    "dynamic",
    "tools"
  ],
  "properties": {
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "method"
        ],
        "additionalProperties": true,
        "properties": {
          "method": {
            "type": "string"
          },
          "stable": {
            "type": "boolean"
          },
          "mutation": {
            "type": "boolean"
          },
          "disabled": {
            "type": "boolean"
          }
        }
      }
    },
    "stable": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tools"
      ],
      "properties": {
        "tools": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "method",
              "stable",
              "mutation"
            ],
            "additionalProperties": true,
            "properties": {
              "method": {
                "type": "string"
              },
              "stable": {
                "type": "boolean"
              },
              "mutation": {
                "type": "boolean"
              }
            }
          }
        }
      }
    },
    "dynamic": {
      "type": "object",
      "additionalProperties": true,
      "required": [
        "generatedAt",
        "mutationEnabled",
        "disabled"
      ],
      "properties": {
        "generatedAt": {
          "type": "string"
        },
        "mutationEnabled": {
          "type": "boolean"
        },
        "disabled": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "method"
            ],
            "additionalProperties": false,
            "properties": {
              "method": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "mcp": {
      "type": "object",
      "additionalProperties": true,
      "required": [
        "registryVersion",
        "tools"
      ],
      "properties": {
        "registryVersion": {
          "type": "string"
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "name",
              "description",
              "stable",
              "mutation",
              "inputSchema"
            ],
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "stable": {
                "type": "boolean"
              },
              "mutation": {
                "type": "boolean"
              },
              "inputSchema": {
                "type": "object"
              },
              "outputSchema": {
                "type": "object"
              }
            }
          }
        }
      }
    }
  }
}
```

### metrics/snapshot
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "generatedAt",
    "methods"
  ],
  "properties": {
    "generatedAt": {
      "type": "string"
    },
    "methods": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "method",
          "count",
          "avgMs",
          "maxMs"
        ],
        "additionalProperties": false,
        "properties": {
          "method": {
            "type": "string"
          },
          "count": {
            "type": "number"
          },
          "avgMs": {
            "type": "number"
          },
          "maxMs": {
            "type": "number"
          }
        }
      }
    }
  }
}
```

### prompt/review
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "truncated",
        "message",
        "max"
      ],
      "additionalProperties": false,
      "properties": {
        "truncated": {
          "const": true
        },
        "message": {
          "type": "string"
        },
        "max": {
          "type": "number"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "issues",
        "summary",
        "length"
      ],
      "additionalProperties": false,
      "properties": {
        "issues": {
          "type": "array",
          "items": {
            "type": "object"
          }
        },
        "summary": {
          "type": "object"
        },
        "length": {
          "type": "number"
        }
      }
    }
  ]
}
```

### usage/flush
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "flushed"
  ],
  "additionalProperties": false,
  "properties": {
    "flushed": {
      "const": true
    }
  }
}
```

### usage/hotset
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "limit",
    "items"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number"
    },
    "limit": {
      "type": "number"
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "usageCount"
        ],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "usageCount": {
            "type": "number"
          },
          "lastUsedAt": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

### usage/track
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "notFound"
      ],
      "properties": {
        "notFound": {
          "const": true
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "id",
        "usageCount",
        "lastUsedAt"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "usageCount": {
          "type": "number"
        },
        "lastUsedAt": {
          "type": "string"
        }
      }
    }
  ]
}
```
