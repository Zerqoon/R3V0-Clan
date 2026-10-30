R3V0 1.16.1 does not ship generated emoji artwork.

Server emojis are created only from official Pet Simulator 99 / BIG Games sources at runtime:
- BIG-Games-LLC/ps99-public-api-docs GitHub Pet Icons when available for pet artwork
- https://ps99.biggamesapi.io/api/collection/{collectionName}
- https://ps99.biggamesapi.io/image/{assetId}

If an official asset cannot be loaded, the bot uses a normal Unicode emoji instead of local/generated artwork.
