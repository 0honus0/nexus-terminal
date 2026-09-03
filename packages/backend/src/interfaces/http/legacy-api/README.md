# Legacy HTTP API compatibility adapters

Temporary migration layer for the current frontend HTTP contract.

- Converts legacy snake_case request/response DTOs to/from the clean backend domain model.
- Must only be imported by `interfaces/http`.
- Modules, Platform, Infrastructure and Bootstrap must not depend on this folder.
- Delete this entire folder when the frontend HTTP API is migrated to the new contract.
