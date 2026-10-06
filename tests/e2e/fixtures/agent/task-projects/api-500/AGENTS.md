# API repair boundaries

Modify only production source to fix the fault. Do not change package scripts or verify.mjs, install dependencies, delete checks, hard-code fixture records, or alter data/catalog.json. Commands must stay within this project. npm test starts a temporary loopback service and always stops it.
