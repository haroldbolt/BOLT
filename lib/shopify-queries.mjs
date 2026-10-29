// Read-only queries discovered from the connected Shopify Admin schema.
export const LOCATIONS_QUERY = "query BoltShopLocations($first: Int!, $after: String) {\n  shop { name myshopifyDomain currencyCode }\n  locations(first: $first, after: $after, includeInactive: true) {\n    nodes { id name isActive fulfillsOnlineOrders address { address1 address2 city country latitude longitude } }\n    pageInfo { hasNextPage endCursor }\n  }\n}";
export const VARIANTS_QUERY = "query BoltVariants($first: Int!, $after: String) {\n  productVariants(first: $first, after: $after, sortKey: ID) {\n    nodes {\n      id title sku price compareAtPrice selectedOptions { name value }\n      media(first: 2) { nodes { ... on MediaImage { image { url altText } } } pageInfo { hasNextPage endCursor } }\n      product { id title handle status vendor productType tags description media(first: 6) { nodes { ... on MediaImage { image { url altText } } } pageInfo { hasNextPage endCursor } } }\n      inventoryItem {\n        id tracked requiresShipping measurement { weight { value unit } }\n        inventoryLevels(first: 5, includeInactive: true) {\n          nodes { location { id } quantities(names: [\"available\", \"on_hand\", \"committed\", \"reserved\", \"safety_stock\"]) { name quantity } }\n          pageInfo { hasNextPage endCursor }\n        }\n      }\n    }\n    pageInfo { hasNextPage endCursor }\n  }\n}";

export const INVENTORY_LEVELS_QUERY = `query BoltInventoryLevels($id: ID!, $first: Int!, $after: String) {
  inventoryItem(id: $id) {
    id
    inventoryLevels(first: $first, after: $after, includeInactive: true) {
      nodes { location { id } quantities(names: ["available", "on_hand", "committed", "reserved", "safety_stock"]) { name quantity } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
