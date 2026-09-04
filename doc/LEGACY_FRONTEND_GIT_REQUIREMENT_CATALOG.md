# Legacy Frontend Git-Derived Requirement Catalog

Status: authoritative fine-grained behavior catalog discovered from Git history plus the final old-frontend baseline. This catalog is open-ended: its size is not constrained by the higher-level FR document.

## Method

For every Git-derived behavior candidate:

1. read the commit/diff evidence;
2. read the final old-baseline implementation and confirm whether the behavior remained product-reachable;
3. separate required behavior from accidental old architecture;
4. inspect the current refactor owner/lifecycle boundaries and refactor them first if necessary;
5. implement the behavior once in the correct current owner;
6. run architecture/i18n/type/build gates for the slice;
7. mark the GREQ complete only after the current implementation preserves the useful final behavior and documented edge cases.

During discovery, historical/current capabilities are not removed merely because another path looks newer or smaller. Potentially redundant capabilities remain **REVIEW** until the full Git-derived catalog is complete; later architecture work may merge duplicate implementations without silently deleting user-visible capability.

The FR document is a readable product summary. It may aggregate many GREQs and is not used as a completeness ceiling.

## Auth / Login / Security

### GREQ-AUTH-001 — CAPTCHA first-factor token lifecycle

**Git/final-baseline evidence:** final `LoginView.vue` resets hCaptcha/reCAPTCHA after each first-factor login attempt, while CAPTCHA is suppressed once the flow enters TOTP second-factor verification.

**Required behavior:** a CAPTCHA token is treated as a consumed challenge, not reusable form state. After a password-login attempt completes (success or failure), the widget/token is reset. TOTP verification does not request or reset another CAPTCHA challenge.

**Old-design review:** the old Auth Store owned CAPTCHA state and widget-adjacent login behavior. That coupling is not required.

**Refactored design:** Auth emits a presentation-neutral “security challenge consumed” intent; App login composition asks the Security-owned challenge component to reset. Auth and Security remain independent feature owners.

**Implementation:** `features/auth/views/LoginView.vue` → App `pages/login/LoginPage.vue` → `features/security/components/LoginCaptchaChallenge.vue`. Both hCaptcha and reCAPTCHA reset through the Security component.

**Status:** PASS — architecture, i18n and Vue typecheck passed for this slice.

### GREQ-AUTH-002 — Initial setup state and post-setup login boundary

**Git evidence:** initial setup flow plus later setup/auth routing fixes.

**Final behavior:** when no administrator exists, protected navigation is redirected to Setup. Setup validates username/password confirmation, creates the administrator, then returns to Login as an anonymous session; setup completion is not treated as an authenticated login.

**Old-design review:** the old Setup view mutated Auth Store state directly. The mutation topology is not required.

**Refactored design/implementation:** Auth owns the setup/session state machine; router consumes an Auth navigation facade. Setup calls the Auth public use case and redirects to Login. No Session/Workspace dependency exists inside Auth.

**Status:** PASS.

### GREQ-AUTH-003 — Password login, remember-me session and TOTP second factor

**Git evidence:** password login/session behavior, TOTP setup/login/disable commits, later auth/session stability fixes.

**Final behavior:** password login accepts remember-me, may transition to a TOTP-required intermediate state, and only becomes authenticated after the second factor succeeds. CAPTCHA applies only to the first factor. TOTP disable requires the current password.

**Old-design review:** old Auth Store combined login, TOTP and unrelated security/settings state. That coupling is removed.

**Refactored design/implementation:** Auth owns login/session state; Security owns TOTP management UI/API. The Login composition exposes second-factor UI only after the Auth state transition. Backend session remains authoritative.

**Status:** PASS.

### GREQ-AUTH-004 — Passkey registration, management and dual-mode login

**Git evidence:** Passkey registration/login additions and the later SimpleWebAuthn v13 compatibility fix.

**Final behavior:** authenticated users can register, list, rename and delete Passkeys. Login supports both username-scoped authentication and discoverable credentials when username is omitted. WebAuthn challenge/origin state is server-session bound.

**Old-design review:** old Auth Store directly owned browser WebAuthn calls and Passkey collection state. This mixed authentication session state with credential-management presentation.

**Refactored design/implementation:** Security owns WebAuthn browser/API operations and Passkey management; Auth owns only the resulting authenticated session. App login composition refreshes Auth after successful Passkey authentication. Backend Interface/Passkey module remain challenge/origin authority.

**Status:** PASS for behavior; HTTP response mapper remains scheduled for clean-contract migration.

### GREQ-AUTH-005 — CAPTCHA provider configuration and secret preservation

**Git evidence:** CAPTCHA introduction and later fix preventing accidental secret clearing.

**Final behavior:** hCaptcha/reCAPTCHA/none are configurable; public login configuration exposes only public site keys. Secret fields are not repopulated into the settings form. Leaving a secret blank while editing preserves the existing backend secret; saved secret form state is cleared.

**Old-design review:** old settings/Auth stores shared CAPTCHA state. Secret-preserve behavior depended partly on form conventions.

**Refactored design/implementation:** Security owns CAPTCHA settings and public login challenge UI. Frontend sends secret fields only when non-empty; Backend Settings service merges partial updates with stored configuration.

**Status:** PASS.

### GREQ-AUTH-006 — Protected navigation, logout and live-runtime cleanup boundary

**Git evidence:** auth/session lifecycle fixes, including preservation of Workspace sessions across normal route navigation.

**Final behavior:** protected routes require a valid backend session. Normal route navigation does not destroy live Workspace sessions. Logout/session loss does clean live Workspace runtime resources.

**Old-design review:** old Auth Store imported Session Store and performed cleanup directly, creating a feature-to-runtime dependency.

**Refactored design/implementation:** Auth exposes authentication state only. Router enforces navigation. App composition observes auth loss/logout and disposes Workspace runtime resources, preserving dependency direction.

**Status:** PASS.

### GREQ-SEC-001 — IP blacklist enablement, thresholds and blocked-entry lifecycle

**Git/final-baseline evidence:** the final `IpBlacklistSettings.vue` / `useIpBlacklist.ts` keep blacklist enablement as an independent persisted switch: a click optimistically changes the control, writes `ipBlacklistEnabled` immediately and reverts on failure. When disabled, threshold controls and the blocked-IP list are not presented. Positive login-attempt/ban-duration thresholds are validated before the separate save. Blocked entries expose IP, attempt count, last-attempt time and banned-until time, and removal requires explicit confirmation before deleting and refreshing the list. The existing repository E2E `ip-blacklist-settings.spec.ts` also treats immediate switch persistence as stable product behavior.

**Required behavior:** the Security IP-control surface must keep enable/disable distinct from threshold editing. Toggling protection persists immediately and a failed write restores the prior visible state; disabled protection does not leave active-looking threshold/list controls exposed. Threshold saves reject missing/non-positive/non-integer values before transport. A blocked entry retains both last-attempt and ban-expiry context, and destructive manual removal is confirmation-gated then refreshes authoritative data.

**Old-design review:** the old behavior was split between Settings and Auth Pinia stores. That topology is unnecessary. Security UI owns only transient form/optimistic state, Backend Settings remains the policy owner, and the blocked-IP HTTP/module path remains authoritative for entries and deletion. No legacy settings mega-store is required.

**Refactored design/implementation:** VALIDATED — the clean Security feature keeps transient form/optimistic state locally while Backend Settings/blacklist services remain authoritative. Blacklist enablement persists immediately and reverts on failure; disabled state hides threshold/list controls; threshold save performs explicit positive-integer validation; blocked rows include last-attempt and ban-expiry context; destructive removal uses shared confirmation and refreshes authoritative data.

**Status:** PASS.

### GREQ-SEC-002 — IP whitelist exposes one effective policy state, not an inert enable toggle

**Git/final-baseline evidence:** `1f363153` introduced the IP whitelist as a newline/comma separated IPv4/IPv6/CIDR allow-list whose empty value means no restriction. The final `IpWhitelistSettings.vue` exposes only that allow-list text plus Save; the later repository `ip-whitelist-settings.spec.ts` explicitly saves/reloads the list “without enabling access control”. Although a historical `ipWhitelistEnabled` setting key remained in the settings store, final frontend presentation never exposed it as a second whitelist lifecycle and the admission policy is defined by the effective allow-list itself.

**Required behavior:** Security must not present a control that appears to enable/disable whitelist admission when the Backend admission owner does not consume that state. Users edit and persist the effective allow-list; an empty list keeps the normal unrestricted behavior, while parsing/matching remains the Backend IP-whitelist policy owner. A dormant compatibility setting must not become a second user-visible source of truth merely because it still exists in the settings schema.

**Old-design review:** `ipWhitelistEnabled` is compatibility residue, not a proven final product state. Making the current frontend model depend on it creates an ownership split because `IpWhitelistService` evaluates only the configured allow-list. The behavior phase should remove the false frontend state while leaving physical compatibility-key deletion to the later settings/HTTP compatibility cleanup.

**Refactored design/implementation:** VALIDATED — `whitelistEnabled` is removed from the clean Security model/API/presentation and the feature saves only the effective whitelist string. Backend admission policy remains unchanged and authoritative; physical removal of the dormant compatibility key is deferred to the contract/compatibility phase.

**Status:** PASS.

### Security residual audit — no additional GREQ

- Change-password remains reachable from the Security settings tab and preserves the final required-field check, confirmation match, loading/error feedback and successful field clearing, so no separate residual gap was opened.
- The old standalone `/tags` route is commented out in the final router; `TagsView.vue` therefore is not proof of a reachable management page. Its actually reachable Workspace tag-to-connection assignment path is retained by the clean `WorkspaceTagGroupManager` with search, visible select/deselect/invert, tag rename/delete and authoritative connection reassignment. No standalone Tags-page GREQ is created from dead code.

## Connections

### GREQ-CONN-001 — Connection list search/filter/sort persistence

**Git/final-baseline evidence:** the final Connections view searches name, host, **port**, username and notes, filters by tag, persists tag/sort/order preferences, and renders tag/notes metadata.

**Required behavior:** list filtering and persisted sort preferences survive the refactor without changing the saved-connection model.

**Old-design review:** the old view mixed filtering, persistence and CRUD/store calls in one component. These are presentation preferences over the Connections owner and do not require another store.

**Refactored design/implementation:** `ConnectionsView.vue` derives filtered/sorted rows from the single Connections store and persists only list-presentation preferences in browser storage. Port search is included with the other searchable visible fields.

**Status:** PASS.

### GREQ-CONN-002 — Credential editing, secret preservation and explicit authentication switching

**Git/final-baseline evidence:** connection history contains password, saved SSH Key and direct private-key credential paths; secret fields are never populated when editing. Blank password preserves an existing password only when the credential mode is unchanged. Switching to password requires a new password; switching to key authentication requires a saved key. RDP/VNC require a usable password.

**Required behavior:** an edit must never silently clear an existing secret or create an unusable credential state. Authentication-mode changes are explicit.

**Old-design review:** the old frontend depended heavily on omitted fields and had ambiguous batch `ssh_key_id` updates. The durable state machine belongs in Backend `ConnectionCredentialService`, not duplicated in Vue forms.

**Refactored design/implementation:** Connection Form performs early UX validation and omits unchanged password values; Batch Edit uses explicit `No change / Password / SSH Key` intent. Backend `ConnectionCredentialService` remains authoritative for preserve/switch/clear legality.

**Status:** PASS.

### GREQ-CONN-003 — Saved and unsaved SSH connection testing

**Git/final-baseline evidence:** saved SSH rows can be tested individually or in the filtered Test-All operation; Add Connection can test the current unsaved SSH configuration before saving. Result message/latency is user-visible.

**Required behavior:** editing a saved connection tests its persisted credential record; adding a new connection tests the entered unsaved credential/proxy/key data. Test state is row-scoped and Test-All does not serialize unrelated rows.

**Old-design review:** testing state in the old view was mixed into a large component map. It is presentation state, not connection business state.

**Refactored design/implementation:** Connections API exposes saved/unsaved test use cases; row testing state stays local to `ConnectionsView`, while Connection Form owns only its current unsaved-test presentation.

**Status:** PASS.

### GREQ-CONN-004 — Script-mode bulk creation and name-based dependency resolution

**Git/final-baseline evidence:** script mode accepts one connection per line with connection type/name/password/key/proxy/tags/notes options. SSH requires password or saved-key name, RDP/VNC require password, invalid ports/types/options fail before connection creation, missing tags may be created automatically, and key/proxy names must resolve.

**Required behavior:** script syntax and dependency resolution remain user-facing bulk-creation capability. Key auth must not also send a password. RDP/VNC reject SSH-key options.

**Old-design review:** the old composable combined parsing, tag mutation, notifications and connection writes. Parsing/resolution belongs in the Connections feature, but actual create mutation remains one Connections store path.

**Refactored design/implementation:** `ConnectionForm.vue` parses/resolves into clean `ConnectionInput` intents and `ConnectionEditorModal` performs creation through the single Connections owner. Parse errors stay in the form instead of becoming unhandled UI promises.

**Status:** PASS.

### GREQ-CONN-005 — IP-range batch creation and partial outcome reporting

**Git/final-baseline evidence:** Add Connection accepts a same-/24 IPv4 `start~end` range in add mode, generates one connection per address, applies the selected credentials/tags/route settings, and reports success/failure counts. Edit mode rejects ranges.

**Required behavior:** a failure for one generated connection does not erase earlier successes or falsely report the entire batch as successful. Partial success remains visible and the form stays available for correction/retry.

**Old-design review:** the old form itself performed repeated store mutation. The generation rule belongs in the form/use case, but execution/result aggregation should be outside the form presentation.

**Refactored design/implementation:** Connection Form emits the generated `ConnectionInput[]`; reusable `ConnectionEditorModal` executes every item through the Connections owner, continues after individual failures, reports aggregate/first-error outcome, and closes only on full success. Script mode uses the same execution path.

**Status:** PASS.

### GREQ-CONN-006 — Proxy route and ordered SSH jump chain

**Git/final-baseline evidence:** SSH connections support direct, configured proxy, or ordered saved-SSH jump-host routing. Jump entries exclude the connection being edited and prevent duplicate hops in the same chain.

**Required behavior:** route-specific fields do not leak into RDP/VNC, proxy and jump route are mutually meaningful, and hop order is preserved.

**Old-design review:** old form state used `proxy_type`, `proxy_id`, `jump_chain` and watcher side effects. The refactor uses an explicit route model and derives wire input once.

**Refactored design/implementation:** `Connection.route` is `null | proxy | jump`; Connection Form presents route-specific controls and emits one clean model. Backend Connections module validates/uses routing.

**Status:** PASS.

### GREQ-CONN-007 — RDP/VNC credentials and RDP RemoteApp fields

**Git/final-baseline evidence:** RDP/VNC are first-class saved connection types with their default ports/password credentials. RDP can optionally launch a published RemoteApp with alias, working directory and arguments; enabling RemoteApp requires an alias.

**Required behavior:** SSH-only auth/routing values are cleared when switching to RDP/VNC and RemoteApp configuration survives create/edit.

**Old-design review:** old form stored RDP fields as presentation-specific booleans plus snake_case DTOs. The current clean model groups them as `RdpOptions`.

**Refactored design/implementation:** Connection Form maps RemoteApp presentation into clean `rdpOptions`; Backend Remote Desktop owner consumes it. Credential legality remains in `ConnectionCredentialService`.

**Status:** PASS.

### GREQ-CONN-008 — Batch selection/edit/delete with no-change semantics

**Git/final-baseline evidence:** users can select all/deselect/invert filtered connections, batch-edit selected port/authentication/proxy/tags/notes, and batch delete after destructive confirmation. Unselected fields must not be overwritten.

**Required behavior:** `No change` is distinct from explicit replacement/clearing. Tags and notes can intentionally become empty. Proxy can explicitly become none. Credential changes are explicit and valid. Batch update/delete attempts every selected item; successful items remain committed while failed items remain selected for retry and are reported truthfully.

**Old-design review:** legacy `undefined/null/empty-string` conventions were ambiguous, especially SSH-key selection without an auth-method transition. That implementation detail is not preserved.

**Refactored design/implementation:** Batch Edit uses explicit enable toggles plus clean tri-state choices; authentication uses `No change / Password / SSH Key`, proxy uses `No change / None / value`, and only chosen fields enter `ConnectionUpdate`.

**Status:** PASS.

### GREQ-CONN-009 — Clone and reusable connection editor composition

**Git/final-baseline evidence:** saved connections can be cloned and managed both from the Connections page and Workspace connection-management surface.

**Required behavior:** these entry points must have identical create/edit secret and validation semantics.

**Old-design review:** duplicating form orchestration in each page would reproduce old drift.

**Refactored design/implementation:** `ConnectionEditorModal` is owned by Connections and reused by Connections and Workspace. Clone is a Connections use case; runtime only invokes the public feature surface.

**Status:** PASS.

### Connections residual audit — no additional GREQ

- The Direct Private Key / passphrase review is closed. Final-old `AddConnectionFormAuth.vue` exposes only the Saved SSH Key selector for Connection key authentication; direct private-key text remains reachable only inside SSH Key management, so it is not a missing final-old Connection requirement. The clean Connection editor nevertheless retains direct-key input as an explicit extension behind a mutually-exclusive `Saved SSH Key / Direct Private Key` source choice: direct input emits `privateKey/passphrase` with `sshKeyId=null`, while saved-key input emits only `sshKeyId`. This extension does not create a second credential owner and is not removed during behavior discovery; its clean camelCase contract must be handled normally in the HTTP migration if production still uses it.
- `b58f5da5` historically added raw JSON Connection import/export, but neither `/connections/export` nor an import UI remains reachable in the final old frontend. The retained final Data Management connection archive export is the separate `GREQ-BACKUP-002` capability. The superseded raw Connection import/export UI is therefore not restored.

### GREQ-CONN-010 — Workspace connection catalog grouping and keyboard navigation

**Git/final-baseline evidence:** Workspace connection search can be focused by the focus switcher; within the search field ArrowUp/ArrowDown cycles the currently visible connections and Enter opens the highlighted connection. Tag groups preserve expanded/collapsed state, expose Connect All for SSH members, tag-member management, rename/delete actions, and truthful partial results when group deletion cannot remove every connection.

**Required behavior:** keyboard navigation operates on the currently visible grouped/flat catalog rather than hidden rows. One saved connection appearing in multiple tag groups should still be one logical keyboard target. Group operations must not pretend all destructive actions succeeded when some failed.

**Old-design review:** the old component kept both `highlightedIndex` and a separately flattened grouped list, relied on deep watchers, and queried legacy DOM selectors. Those mechanics are not requirements.

**Refactored design/implementation:** `WorkspaceConnectionList.vue` keeps only `highlightedId`; its navigation list is derived from the existing filtered/grouped/expanded state and de-duplicates connection IDs. Enter emits the normal `open` intent. Group deletion uses the same Connections owner and reports settled success/failure counts. Expanded state remains presentation-only browser persistence.

**Status:** PASS.

## Tags / Quick Command Tags

### GREQ-TAG-001 — Keyboard token selection, creation, local removal and global deletion

**Git evidence:** `bc85d52a`, `026ed949`, `598df938`, later `TagInput.vue` fixes, and the final Connection/Quick Command forms.

**Final behavior:** tag inputs show matching available tags, Enter selects an exact existing tag or creates a new tag when creation is allowed, and Backspace on an empty input removes the last locally-selected tag. Selected tags can also be removed only from the current object or explicitly deleted globally after destructive confirmation. Connection tags and Quick Command tags are separate resources and retain their own CRUD ownership.

**Old-design review:** the legacy generic `TagInput` emitted business-flavored create/delete events while parent components directly manipulated different tag stores. Reusing that topology would make Foundation understand product-specific tag deletion.

**Refactored design/implementation:** Foundation `TokenInput` owns only generic token interaction and emits `create` / `deleteOption` intents. `ConnectionTagPicker` handles Connection-tag create/global-delete through the Tags owner. `QuickCommandForm` handles Quick Command tag create/global-delete through the Quick Commands owner. Both use the same keyboard/local-removal primitive without merging the two business tag domains.

**Status:** PASS.

### Tags residual audit — no additional GREQ

- The final router leaves the standalone `/tags` route commented out, so the surviving `TagsView.vue` source is dead presentation rather than proof of a reachable product page. Reachable Connection-tag management remains in Connection forms and Workspace tag groups; Quick Command tags remain a distinct owner. The clean feature preserves those paths through `ConnectionTagPicker` and `WorkspaceTagGroupManager`, while `GREQ-CONN-010` covers tag-group membership/rename/delete composition. No standalone Tags management page is restored.

## Proxies

### GREQ-PROXY-001 — Proxy CRUD, credential preservation and explicit password clearing

**Git/final-baseline evidence:** final `AddProxyForm.vue` / `ProxyList.vue`, including the edit-password preservation fix and the explicit “clear stored password” control.

**Required behavior:** SOCKS5/HTTP proxy records preserve name/host/port/optional username. On edit, blank password means keep the stored password; entering a new password updates it; explicit Clear removes it. New-password input and Clear are mutually exclusive so the form cannot submit contradictory secret intent. Port must be an integer in 1–65535. The management list retains useful username and last-updated context.

**Old-design review:** the old form implemented the secret tri-state through ad-hoc input/change handlers. The behavior is required, but secret state should be explicit and Backend Proxy service remains authoritative.

**Refactored design/implementation:** `ProxyForm.vue` keeps one presentation model with mutually-exclusive `password` / `clearPassword`; only the chosen secret intent enters `ProxyInput`. Local validation catches malformed required fields/ports before mutation. `ProxiesView.vue` uses the single Proxy owner and reports mutation failures instead of leaking rejected promises.

**Status:** PASS for frontend behavior; the current snake_case HTTP mapper remains scheduled for clean-contract migration.

### Proxies residual audit — no additional GREQ

- Final `AddProxyForm.vue` / `ProxyList.vue` adds no reachable capability beyond `GREQ-PROXY-001`: SOCKS5/HTTP CRUD, optional username/password, edit-time secret preservation/explicit clearing, validated ports, delete confirmation and updated-at context are all retained. Historical unused Tag imports in the proxy form do not make proxy tagging a reachable capability and are not restored.
- Proxy routing for SSH Connections is not Proxy-management state; its reachable semantics remain covered by `GREQ-CONN-006` and the Connections owner.

## SSH Keys

### GREQ-SSHKEY-001 — SSH key CRUD without secret re-exposure during edit

**Git evidence:** `2a201739`, `4b9d086a`, subsequent SSH key management fixes, and final `SshKeyManagementModal.vue`.

**Final behavior:** creating a stored SSH key requires name + private key and accepts an optional passphrase. Editing may rename only, replace the private key, or update the passphrase without re-entering the private key. Blank private-key/passphrase fields preserve the existing stored values when that field is not being replaced.

**Old-design review:** the legacy modal fetched decrypted key details before editing even though it intentionally blanked the private-key/passphrase inputs. That secret round-trip is unnecessary and is not reproduced.

**Refactored design/implementation:** the management modal edits from public summary data only. It sends private key/passphrase only when the user actually enters replacements. Backend `SshKeyService` owns encryption and partial-update semantics. User-facing notes state the preserve/update behavior accurately.

**Status:** PASS for behavior; HTTP wire cleanup remains pending.

### GREQ-SSHKEY-002 — Selector stays valid while key management mutates the catalog

**Git/final-baseline evidence:** final `SshKeySelector.vue` watches the key catalog and clears a selected id when that key is deleted from the management modal or elsewhere.

**Required behavior:** a Connection form must never retain a stale saved-key id after the key disappears. Adding/renaming/deleting keys through the embedded manager updates the selector from the single SSH Key owner.

**Old-design review:** the old selector duplicated internal selected state and synchronized it with props/store through multiple watchers. That duplication is not required.

**Refactored design/implementation:** the current selector binds directly to one model value and watches only the owner’s key catalog; if the selected id no longer exists it sets the model to null.

**Status:** PASS.

### SSH Keys residual audit — no additional GREQ

- `9384a385` only made the legacy key list scroll inside its modal; this is presentation containment rather than a distinct business capability. The clean modal remains bounded/scrollable through the shared modal/table composition and no new owner is required.
- Final-old still fetched decrypted key details before editing even though private-key/passphrase inputs were intentionally blank. `GREQ-SSHKEY-001` deliberately does not reproduce that unnecessary secret round-trip; current edit-from-summary plus partial replacement is the cleaner equivalent and remains authoritative.

## Quick Commands / Command History

### GREQ-QC-001 — Quick Command CRUD, variables, tags and group editing

**Git evidence:** `747c9491`, `026ed949`, `807a48a7` and later Quick Command/tag fixes.

**Required behavior:** Quick Commands preserve optional name, command text, variables and multiple Quick Command tags. Search matches name/command/tag names. Tagged commands appear in tag groups and untagged commands remain reachable. Group expansion state persists. Existing tag group names can be edited inline. The Untagged group title can create a new tag and bulk-assign the currently untagged commands to it. Creating the tag and assigning commands are two operations; if assignment fails after tag creation, the UI reports a partial outcome instead of pretending the tag was not created.

**Old-design review:** the old view mixed input-ref maps, event-bus dispatch, tag store mutation and group presentation in one component. Those mechanics are not required.

**Refactored design/implementation:** Quick Commands store owns tag CRUD, bulk assignment and group expansion-state migration; `QuickCommandsPanel` owns only the active inline-edit draft. `TokenInput` remains a generic interaction primitive and Quick Commands handles its own tag business operations.

**Status:** PASS.

### GREQ-QC-002 — Execution, variable expansion and non-blocking usage accounting

**Git evidence:** `807a48a7`, usage-sort behavior in the final store, and later command-execution fixes.

**Required behavior:** stored variables replace `${NAME}` placeholders before execution; unresolved variables produce a warning without silently corrupting the command. Execution can target the current session or all active sessions. Usage count/last-used metadata updates after execution and affects Usage/Last-used sorting. Failure to record usage is auxiliary and must never prevent the command from being sent.

**Old-design review:** old usage accounting sometimes refreshed the complete command list solely to re-sort. The durable requirement is authoritative usage metadata, not a full-list refetch.

**Refactored design/implementation:** command intent is emitted first. Usage accounting runs asynchronously; the Backend usage endpoint returns the updated command and the single Quick Commands store merges that authoritative record. Accounting failure is swallowed inside the owner and does not affect terminal execution.

**Status:** PASS.

### GREQ-QC-003 — Quick Command presentation controls and clipboard/action parity

**Git evidence:** `a267cbd3`, `d8cec9f2`, `95ad63ad`, `5edb89eb`, `2910951c`, `1eb1efde`, `cc0f0335` and mobile fixes.

**Required behavior:** Quick Commands retain compact mode, name/command display mode, row scaling, collapsible search, grouped/ungrouped display, Copy, Edit, Delete, execute-current and Send-to-all actions. Clipboard copy must degrade through the shared fallback when the modern Clipboard API is unavailable.

**Old-design review:** separate mobile action layouts and custom context-menu viewport math were duplicated presentation mechanics.

**Refactored design/implementation:** one `QuickCommandsPanel` handles desktop/mobile presentations, uses Foundation context-menu/clipboard primitives, and emits transport-neutral execution intents. Display mode remains browser-local presentation preference while compact/scale settings use their existing owners.

**Status:** PASS.

### GREQ-QC-004 — Quick Command search keyboard navigation stays aligned with the visible command set

**Git/final-baseline evidence:** final `QuickCommandsView.vue` handles `ArrowDown` / `ArrowUp` / `Enter` directly from the Quick Command search input, operates on the store’s flattened currently-visible commands, scrolls the selected row into view, and collapses an empty collapsible search on Escape. Selection is reset when search/sort/group visibility changes so Enter cannot execute a hidden stale row.

**Required behavior:** while the Quick Command search field has focus, ArrowDown/ArrowUp cycle the commands that are actually visible under the current search, grouping and expanded/collapsed state; Enter executes the highlighted visible command through the normal execution intent. The highlighted row is visibly selected and is scrolled into the panel viewport. When collapsible search is enabled, Escape with an empty query collapses the search rather than becoming a terminal command. Search keyboard behavior must not create another command collection or selection owner.

**Old-design review:** the final view used an integer selected index plus DOM query by command id. The clean Quick Commands store already owns `selectedId` and derives grouped visible/flat collections, so the panel only needs to map keyboard presentation events to that existing owner and reveal the selected row.

**Refactored design/implementation:** VALIDATED — `QuickCommandsPanel` maps search-field ArrowDown/ArrowUp/Enter onto the existing store-owned visible selection, reveals the selected `data-command-id` row with nearest scrolling, and collapses empty collapsible search on Escape. Blur only resets selection after focus leaves the panel; no duplicate command list/index owner was introduced.

**Status:** PASS.

### GREQ-HIST-001 — Command History recording semantics and serialized writes

**Git evidence:** `b62982fa`, later command-input integration, and `b09715bd` serialized-history stability fix.

**Required behavior:** ordinary commands successfully sent to the current session are recorded once. Empty Enter, Ctrl+C, Send-to-all and commands that were not actually sent do not pollute history. Rapid submissions are serialized so an older refresh cannot overwrite a newer history snapshot. One failed history write must not poison the queue and prevent all later writes. History persistence failure must not undo or block a terminal command that was already sent.

**Old-design review:** the legacy store serialized POST+refresh operations correctly but mixed localStorage cache, notifications and API state. Persistent browser caching of command text is implementation policy, not required business ownership, and can retain sensitive command strings unnecessarily.

**Refactored design/implementation:** the Command History store owns one recoverable mutation queue. Each returned operation may fail to its caller, while the internal queue recovers before the next item. Workspace records only a successful single-session send and reports a history-save failure separately from terminal execution.

**Status:** PASS.

### GREQ-HIST-002 — History search, keyboard selection and management actions

**Git/final-baseline evidence:** final Command History view and command-input sync behavior.

**Required behavior:** history is newest-first, searchable, keyboard-selectable from the configured Command Input sync target, and supports execute, Copy, Send-to-all, single delete and Clear-all with destructive confirmation. Clipboard uses the common fallback. Load/delete/clear failures remain visible instead of becoming unhandled promises.

**Old-design review:** legacy context-menu positioning/event-bus details are presentation implementation, not the capability.

**Refactored design/implementation:** one feature store owns list/search/selection and errors; `CommandHistoryPanel` owns confirmation/feedback and public execute intents. Command Bar consumes only the feature public selection/search surface.

**Status:** PASS.

### GREQ-HIST-003 — Command History search keyboard navigation executes only the current filtered selection

**Git/final-baseline evidence:** final `CommandHistoryView.vue` binds `ArrowDown` / `ArrowUp` / `Enter` on its search input, cycles the current filtered newest-first history, scrolls the selected entry into view and resets selection when search/focus context changes. This is separate from the Command Input sync target: users can navigate history directly inside the History panel itself.

**Required behavior:** while History search has focus, ArrowDown/ArrowUp wrap through the current filtered history and Enter executes only the highlighted entry through the existing History execute intent. The selected row remains visibly highlighted and is scrolled into the panel viewport. Changing the search must invalidate the old selection; panel keyboard navigation and Workspace Command Input synchronization share the same store selection owner rather than maintaining competing indexes.

**Old-design review:** the legacy view used a selected index and queried the row DOM after each change. The clean Command History store already owns `selectedIndex`, filtered history and next/previous/reset operations, so only presentation key handling and reveal belong in `CommandHistoryPanel`.

**Refactored design/implementation:** VALIDATED — `CommandHistoryPanel` maps search-field ArrowDown/ArrowUp/Enter onto the existing store-owned filtered selection, reveals the selected `data-history-id` row with nearest scrolling, and resets selection only after focus leaves the panel. Workspace Command Input synchronization continues to consume the same store selection owner.

**Status:** PASS.

### Quick Commands / Command History residual audit — closed

- Final Quick Command delete confirmation, Copy/Edit/Delete/current-session/Send-to-all actions, Name/Usage/Last-used sorting, variable expansion/warnings, group rename/Untagged assignment, compact/display/scale/search controls and non-blocking usage accounting remain covered by `GREQ-QC-001..004`. The residual gap was only direct search-field keyboard navigation/reveal, now closed by `GREQ-QC-004`.
- Final Command History newest-first search, serialized recoverable recording, Copy/Send-to-all/delete/Clear-all, load/mutation feedback and Command Input sync remain covered by `GREQ-HIST-001..003`. Final-old confirms only Clear-all is destructively confirmed; single-row delete is immediate, matching the clean panel. The residual gap was only direct History-search keyboard navigation/reveal, now closed by `GREQ-HIST-003`.

## Notifications / Audit / Backup / About

### GREQ-NOTIFY-001 — Complete channel configuration and validation UX

**Git evidence:** the long-lived `NotificationSettingForm.vue` history, `e541876f` multi-recipient Email fix, `d7bee113` Telegram custom-domain addition, and final channel form behavior.

**Required behavior:** Webhook supports URL, method, JSON headers and body template. Email supports a comma-separated/multiple-recipient `to` field, body template, required SMTP host/port/from, TLS/SSL toggle defaulting to enabled, optional SMTP username/password and sender address validation. Telegram supports required bot token/chat id on creation, optional message template and custom API domain. Template placeholders and secret-handling hints remain visible. Channel type cannot be changed after creation.

**Old-design review:** the legacy form held separate per-channel refs and mixed validation/test logic. The product behavior is required, but a second validation store is unnecessary.

**Refactored design/implementation:** one feature-owned form model branches by channel type and uses native input constraints for early UX validation; Backend notification/channel services remain authoritative. Existing capabilities are retained rather than trimmed.

**Status:** PASS.

### GREQ-NOTIFY-002 — Saved/unsaved test semantics and secret preservation

**Git/final-baseline evidence:** final notification testing flow and later secret/config fixes.

**Required behavior:** a newly-created unsaved channel can be tested only when the required current-form fields are complete, and the test uses the current draft config. Editing an existing setting tests the already-saved database config, regardless of unsaved/temporarily-invalid form edits. Blank SMTP password or Telegram bot token on update preserves the existing stored secret; a newly-entered value replaces it.

**Old-design review:** preserving secrets by returning them to the browser and resubmitting them couples UI to secret storage and unnecessarily exposes credentials.

**Refactored design/implementation:** `NotificationSettingsService` owns update merge semantics and preserves omitted secrets; frontend sends only newly-entered secrets. Saved-test directly calls the saved-setting endpoint and does not parse the edit draft first. Clean HTTP migration will additionally redact secrets from Interface responses.

**Status:** PASS for behavior and Module ownership; response DTO redaction remains part of clean HTTP migration.

### Notifications residual audit — no additional GREQ

- Final Notification form/list behavior was rechecked against the clean feature. Channel type remains immutable on edit; Webhook keeps method/JSON headers/body template, Email keeps multi-recipient address input, SMTP validation/default TLS and optional credentials, and Telegram keeps token/chat/template/custom domain. Secret inputs remain blank during edit.
- Saved-channel Test still calls the saved-setting endpoint directly and therefore ignores unsaved draft edits, while new-channel Test is enabled only when the current draft has its required fields and valid Webhook headers. No additional lifecycle/validation/owner gap was found beyond `GREQ-NOTIFY-001/002`; HTTP response secret redaction remains intentionally deferred to contract migration.

### GREQ-AUDIT-001 — Applied audit filters and complete action catalog

**Git evidence:** final `AuditLogView.vue`, including the explicit Apply-filter behavior and accumulated audit-action additions.

**Required behavior:** users can draft search/action filters and explicitly Apply them; Apply resets pagination to page 1. Page navigation reuses the last applied filter snapshot rather than partially-edited draft values. The action selector exposes the complete supported/current action catalog, including authentication, Passkey, connection, proxy, tag, settings/CAPTCHA, notification, SSH/system and retained Remote Desktop action labels.

**Old-design review:** neither a deep-watched filter store nor per-keystroke API requests are necessary. Backend date-query parameters that had no final old UI are retained in the model/API but are not fabricated into a historical UI requirement.

**Refactored design/implementation:** `AuditLogView` owns draft filter fields plus one applied query snapshot; the Audit feature model owns the action-type constant. Pagination changes only offset/page state and calls the same applied query.

**Status:** PASS.

### GREQ-AUDIT-002 — Audit pagination and details resilience

**Git/final-baseline evidence:** final numbered pagination and `formatDetails()` parse-error behavior.

**Required behavior:** pagination exposes previous/next plus a bounded numbered page range with ellipses for large result sets. Structured details are pretty-printed; if the backend/repository exposes a parse-error wrapper with the raw value, the raw content remains visible instead of disappearing behind JSON formatting failure. Load errors are surfaced through localized presentation fallback.

**Refactored design/implementation:** pagination is pure View presentation derived from `total/page/limit`; Audit store owns only page data/loading/error and no UI-localized strings.

**Status:** PASS.

### Audit residual audit — no additional GREQ

- The final explicit Apply-filter snapshot, page reset/reuse, bounded numbered pagination/ellipses and raw parse-error details remain covered by `GREQ-AUDIT-001/002` and are present in the clean View/store split.
- Backend audit action literals were compared with the clean selector catalog. The frontend catalog covers every action currently emitted by Backend and intentionally retains final/historical labels such as 2FA, database migration and Remote Desktop actions. No current Backend action is hidden from the selector, so no additional action-catalog GREQ is needed.

### GREQ-BACKUP-001 — Encrypted full backup export/import lifecycle

**Git evidence:** `87b26877` and final Data Management backup composables/section.

**Required behavior:** full export requires the current login password, downloads the backend backup artifact and clears the password after success. Import accepts `.nexus-backup`; same-instance restore may leave the backup password blank while cross-instance restore uses the password from export. Successful import reports restored row/file counts, clears sensitive input/selected file state, then reloads the application so all in-memory owners reinitialize from restored data.

**Old-design review:** legacy composables split export/import into several helper layers. These are presentation operations over one Backup API, not durable business stores.

**Refactored design/implementation:** `BackupSettingsPanel` owns independent export/import operation state and calls one `backupApi`. Export and import do not unnecessarily lock each other. Backend `Content-Disposition` filename is preferred, including UTF-8 `filename*`, with a stable fallback.

**Status:** PASS.

### GREQ-BACKUP-002 — Independent connection-data ZIP export

**Git/final-baseline evidence:** Data Management connection-export composables retained alongside full backup.

**Required behavior:** connection data can be exported independently of a full backup. The UI explains the archive/decryption context, exposes operation loading, and reports success/failure. The downloaded filename honors Backend `Content-Disposition` with a stable ZIP fallback.

**Refactored design/implementation:** this remains a third independent operation in the Backup/Data Management presentation but reuses `backupApi` and the same download filename parser.

**Status:** PASS.

### Backup residual audit — no additional GREQ

- Final `DataManagementSection.vue`, `useDataBackup.ts` and `useExportConnections.ts` were rechecked against clean `BackupSettingsPanel`/`backupApi`: current-password export gating and clearing, `.nexus-backup` selection, optional same-instance import password, restored row/file counts, sensitive form/file clearing, application reload and independent connection ZIP export all remain reachable under `GREQ-BACKUP-001/002`.
- The clean filename parser additionally supports UTF-8 `filename*`; that is a compatible robustness improvement, not a separate product owner or new historical requirement.

### GREQ-ABOUT-001 — Version/release information and update check

**Git evidence:** `91dc1a3d`, `c4d9fd09`, and final `AboutSection.vue`/`useVersionCheck`.

**Required behavior:** About shows the running package version and configured repository, automatically checks the repository’s latest GitHub release when mounted, compares release versions semantically, links to a newer release and distinguishes up-to-date, no-release, rate-limit and generic failure states. The final old UI did not expose a separate manual retry button, so one is not required for parity.

**Old-design review:** a Pinia/store is unnecessary for a one-surface, mount-scoped remote check.

**Refactored design/implementation:** page-local `AboutPanel` + `aboutRelease.ts` own this transient lookup; unmount aborts the request and no product store is introduced.

**Status:** PASS.

## Preferences / Appearance

### GREQ-PREF-001 — Unified preferences persistence without the legacy settings mega-store

**Git evidence:** `9adf6b3b`, `0b08a221`, the final `WorkspaceSettingsSection.vue` / `SystemSettingsSection.vue`, and later setting-specific additions such as `978aa942`, `e886d13e`, `0e396a92`, `95ad63ad`, `c2c4c81c`, `c270b5e0` and `86a8e6af`.

**Required behavior:** all retained system/workspace preferences remain editable and persistent: language/timezone, popup editor/file manager, shared editor tabs, terminal right-click copy/paste/scrollback, sidebar persistence, command-input sync, Connection/Quick Command tag visibility, collapsible/compact Quick Commands, file-delete confirmation, status/Docker/dashboard refresh/display settings, spreadsheet preview limits and the presentation sizing/visibility preferences used by Workspace.

**Old-design review:** the historical settings store accumulated unrelated security, layout, Workspace, appearance and presentation state plus dozens of near-identical per-setting loading/message refs. Restoring that topology would recreate a cross-feature mega-store and duplicate mutation plumbing.

**Refactored design/implementation:** `features/preferences` is the owner of general persisted preference values and exposes one load/update surface. `PreferencesSettingsPanel` intentionally uses one draft and one save operation state instead of dozens of independent forms. Layout, Appearance, Security and other true business owners remain separate. Runtime consumes Preferences through its public surface rather than owning copies.

**Status:** PASS for restored preference behavior; clean HTTP DTO migration remains pending.

### GREQ-PREF-002 — Language names and complete timezone choices

**Git/final-baseline evidence:** final `useSystemSettings.ts` exposes localized-friendly language names (`English`, `中文`, `日本語`) and the 26-entry common timezone list rather than only a few development-zone samples.

**Required behavior:** locale selection remains understandable without requiring users to interpret locale codes, and the common timezone choices available in the final product remain selectable. Notification timestamp formatting continues to consume the persisted timezone.

**Refactored design/implementation:** Preferences owns the stable timezone option list and the locale display-name mapping used by its settings surface. App i18n remains responsible only for activating the selected locale after save.

**Status:** PASS.

### GREQ-PREF-003 — Terminal scrollback zero/default and safe runtime semantics

**Git evidence:** `4c983945`, final `settings.store.ts` scrollback getter, and Terminal’s `getScrollbackValue()` guard.

**Required behavior:** users may persist an integer from 0–100000. `0` means “use the default 5000”; missing/invalid/negative values also resolve safely to 5000, while positive values are capped at 100000. The terminal must never receive raw `0` as an accidental zero-history configuration when the user intended the documented default behavior.

**Old-design review:** legacy code normalized the value both in the settings getter and again in Terminal, duplicating the same policy in two layers.

**Refactored design/implementation:** the normalization policy lives once in Preferences and Workspace consumes the normalized runtime value. The settings UI still accepts/persists `0` as the explicit default sentinel.

**Status:** PASS.

### GREQ-PREF-004 — Versioned settings-schema migration and terminal right-click copy/paste

**User-directed requirement change:** historical auto-copy-on-select is explicitly retired. The retained terminal clipboard preference is one `terminalRightClickCopyPaste` switch, enabled by default. When enabled, desktop right-click copies and clears an existing selection; with no selection it pastes through xterm semantics. When disabled, the application does not take over desktop terminal right-click.

**Migration requirement:** settings-schema changes are versioned independently from SQL schema changes. `settings_migrations(version,name,applied_at)` records each applied configuration migration. Every migration applies its settings patch and history row in one database transaction; new installations record no-op migrations as well, giving every database an explicit settings schema version. Backup/restore carries this history. Restoring an older backup without settings migration history resets the version to 0 and reruns the current migration chain.

**Current migrations:** v1 renames `terminalEnableRightClickPaste` to `terminalRightClickCopyPaste` without overwriting an already-present new value; v2 removes `autoCopyOnSelect`; v3 removes the historical `clearFileEditorTabsOnClose`. Current frontend/backend schema contains none of those legacy keys.

**Old-design review:** compatibility checks must not be scattered through Preferences, Terminal, HTTP routes or `SettingsService.ensureDefaults()`. Legacy keys belong only in the migration definitions.

**Refactored design/implementation:** the Settings module declares ordered migrations; a dedicated migration repository port records versions; SQLite infrastructure applies each patch and history row atomically. `SettingsService` consumes only the resulting current schema.

**Status:** PASS.

### Preferences residual audit — no additional GREQ

- Final-old `spreadsheetPreviewMaxRows` is explicitly a legacy compatibility key: the final store migrates/falls back from it into `spreadsheetPreviewRowsPerPage`, while the reachable settings UI exposes only rows-per-page plus max columns. Clean Preferences correctly models only the effective current pair; the legacy key belongs to later settings-compatibility deletion, not a new preference capability.
- Nav-bar visibility remains a reachable Workspace presentation preference even though it is not shown in final `SystemSettingsSection.vue`: final `TerminalTabBar` exposes hide/show and the old layout owner persists it through `/settings/nav-bar-visibility`. Clean Workspace retains the same hide/show action and Preferences-backed `navBarVisible` state, so `GREQ-PREF-001` already covers the surviving presentation-visibility preference.
- The remaining final System/Workspace controls map to existing `GREQ-PREF-001..004` plus the domain GREQs that consume them; no additional retained setting was found in the residual Git/final-old pass.

### GREQ-APPEAR-001 — UI theme field editor, raw JSON editor and mode presets

**Git evidence:** the final `StyleCustomizerUiTab.vue`, including default/dark modes, per-variable editing, raw theme editor and parse-error flow.

**Required behavior:** users can edit UI theme variables individually or edit the same theme as a raw JSON object. Valid raw edits synchronize back into the field editor; invalid JSON/object/value shapes remain visible as parse errors and cannot be silently saved. Default and dark-mode presets remain one-click persisted choices.

**Old-design review:** keeping a field-model object and a separately-authoritative raw string creates drift unless one synchronization path owns conversion.

**Refactored design/implementation:** `BasicAppearancePanel` keeps one reactive theme object plus a transient raw edit string. `model/themeEditor.ts` is the single Appearance-internal parser/formatter shared with Terminal Theme editing; raw input is applied back into the same object on blur/save. No second theme store is introduced.

**Status:** PASS.

### GREQ-APPEAR-002 — Terminal theme CRUD, presets, Edit-as-Copy and dual editing

**Git/final-baseline evidence:** final `StyleCustomizerTerminalTab.vue` supports applying themes, creating/updating/deleting custom themes, editing preset themes as a new copy, per-field/color editing, raw JSON editing, search, import/export and active-theme display.

**Required behavior:** preset themes are immutable/deletion-protected but remain editable through “Edit as Copy”. Custom themes can be edited in place. Field/color controls and raw JSON are two views of the same theme draft and must stay synchronized. Invalid raw JSON blocks save. The theme list and active selector are name-sorted for stable navigation.

**Old-design review:** the legacy terminal customizer carried `editingTheme`, `editableTerminalThemeString` and multiple watchers that could each become authoritative. That duplicated state is not required.

**Refactored design/implementation:** `TerminalThemeSettingsPanel` owns one `themeDraft`; field controls mutate it directly and the shared parser/formatter synchronizes the raw editor. Editing a preset opens the same editor with no source id and a localized copy name, so save creates a new custom theme. Editing a custom theme retains its id and updates in place.

**Status:** PASS.

### GREQ-APPEAR-003 — Background assets, terminal visual effects and HTML theme repositories

**Git evidence:** `a4893e56`, `e11cc661`, `81b26cd6`, `c7fd6c3d`, `2ae25c35` and the final `StyleCustomizerBackgroundTab.vue`.

**Required behavior:** page/terminal image backgrounds can be uploaded/removed; terminal background enablement and overlay opacity persist; custom HTML background content can be applied/cleared; text stroke/shadow effects persist; local HTML themes support search/apply/create/edit/rename/delete and preset edit-as-copy; remote HTML themes support configured repository URL, refresh/search/apply and missing-download-url handling. Local and remote lists are sorted by name.

**Old-design review:** remote/default repository policy must not be duplicated in the frontend. The Backend Appearance module already owns the canonical official repository default and legacy-URL migration.

**Refactored design/implementation:** `TerminalBackgroundSettingsPanel` owns presentation/editor state and uses one Appearance API. `AppearanceSettingsService` remains authoritative for defaults/settings, while infrastructure owns files/network retrieval. Frontend sorting is presentation-only and does not duplicate repository data.

**Status:** PASS.

### GREQ-APPEAR-004 — Font, mobile font and PWA window color settings

**Git evidence:** `f8c651da`, `5a4049b3`, `0e3380da`, `5f7c7572`, `39808e5a`, `33c83fdf` and final Appearance customizer behavior.

**Required behavior:** desktop/mobile Terminal font sizes, Terminal font family, desktop/mobile editor font sizes, editor font family and standalone/PWA window theme color remain persistently configurable. Window theme color updates the document `theme-color`; UI theme/page background settings apply immediately to the running app.

**Old-design review:** these are one Appearance aggregate, not separate product stores for every visual field.

**Refactored design/implementation:** Appearance store owns the loaded aggregate and immediate browser application; Workspace receives terminal/editor visual values as runtime composition inputs without duplicating them into session business state.

**Status:** PASS.

### Appearance residual audit — no additional GREQ

- `4a29afd5` temporarily introduced a press-and-hold Terminal-theme preview state in the older monolithic customizer, but the final `StyleCustomizerTerminalTab.vue` contains no preview control or preview state. Apply/Edit/Delete and Edit-as-Copy remain the final reachable theme interactions and are already covered by `GREQ-APPEAR-002`; the removed transient preview is not restored.
- Final UI/Terminal/Background/Other tabs were rechecked against the clean Appearance panels. Font/mobile font, UI/raw theme editing, terminal theme import/export/search, image/HTML backgrounds, visual effects and local/remote HTML repositories all map to `GREQ-APPEAR-001..004`. No remaining reachable Appearance capability or owner gap was found.

## Dashboard / System Overview

### GREQ-DASH-001 — Quick-connect context retains latest reconnect, last-connected state and tags

**Git/final-baseline evidence:** `20331c8d` retained last-connected and tag context on every Dashboard quick-connect row; `c270b5e0` added a dedicated latest-used connection summary with a Reconnect action, and the later `d26a21ff` rebalance plus the final `DashboardView.vue` kept that entry point. The latest connection is derived from the newest non-null `last_connected_at`, not from a second persisted Dashboard record.

**Required behavior:** Dashboard quick connect remains more than a name/host launcher. Each row exposes the connection type, endpoint, localized relative last-connected time and current Connection-tag names. When at least one saved connection has been used, Dashboard exposes the most recently connected record and a direct reconnect action. Never-connected rows still remain reachable and render the normal “never” last-connected state. All connect/reconnect entry points use the normal Workspace launch path for the saved Connection id.

**Old-design review:** the old Dashboard called the Session mega-store directly and rebuilt tag names from Pinia stores. Neither topology is required. Connections and Tags remain their single business owners; Dashboard derives presentation context from their public models and routes the selected saved connection into Workspace composition.

**Refactored design/implementation:** the clean Dashboard now derives the newest used Connection from the Connections owner, exposes its normal Workspace reconnect path, and restores per-row relative last-connected/tag context without introducing a second connection or tag state owner.

**Status:** PASS.

### GREQ-DASH-002 — Recent audit cards preserve failure semantics, concise context and localized relative time

**Git/final-baseline evidence:** `20331c8d` consolidated the final recent-activity presentation: the latest five audit entries render localized action labels, visually distinguish action types containing failure/error/denied semantics, show localized relative timestamps and derive a short useful summary from structured details (`connectionName`/legacy `connection_name`, username/host/ip, command/path/filename, or raw parse fallback). The final `DashboardView.vue` retains this behavior and the link to the complete Audit view.

**Required behavior:** the Dashboard recent-audit surface shows at most the latest five entries and does not reduce them to action name plus absolute timestamp. Failed/denied/error actions remain visibly distinguishable; structured details contribute a bounded one-line summary when useful; timestamps use the active locale’s relative-time presentation with a safe fallback. Unknown action labels remain readable as their raw action type. Audit remains the canonical data owner and the full Audit page remains reachable.

**Old-design review:** these are Dashboard presentation semantics over Audit-owned records, not another audit store. The old date-fns locale map and detail formatter may be rewritten locally as pure presentation helpers; raw/legacy detail-key tolerance does not make Dashboard a transport owner.

**Refactored design/implementation:** the clean Dashboard now requests only the five recent Audit-owned entries, keeps unknown actions readable, restores failure/error/denied emphasis, derives the bounded final-old summary from structured detail fields and formats timestamps relatively with the active locale and safe fallback.

**Status:** PASS.

### GREQ-DASH-003 — Local/remote resource refresh is independent and non-destructive

**Git/final-baseline evidence:** `c270b5e0`, `6f92747c`, `9fc09fa9` and `86a8e6af` establish independently configurable local and configured-SSH resource sections and separate local/remote refresh cadences. Final `DashboardView.vue` guards overlapping remote refreshes and, critically, a transient local or remote request failure does not erase the last successful snapshot: local failure only records an error while retaining `localSystemStatus`; remote failure logs/finishes the refresh while retaining `remoteResourceHosts`. `0a9c62c8` further keeps the initial empty remote loading state coherent rather than flashing a misleading empty state.

**Required behavior:** local and remote resource refresh lifecycles do not block one another or the rest of Dashboard. Each polling family has at most one request in flight, uses its persisted Settings-owned cadence, and an interval/display setting change takes effect on the active Dashboard lifecycle. Initial load exposes loading/empty/error appropriately, but after a successful snapshot a transient refresh failure preserves that useful snapshot instead of destructively replacing it with `null`/`[]`. Explicitly disabling a resource family may clear its presentation state because the user has hidden that family.

**Old-design review:** polling presentation belongs to Dashboard/System Overview, while refresh values remain Preferences/Settings-owned and Backend remains authoritative for remote snapshot collection. No global Session/status store is needed. Request state and last successful clean model belong in the System Overview feature instance used by Dashboard.

**Refactored design/implementation:** `useSystemOverview()` now leaves the last successful local/remote snapshot intact on refresh failure while exposing the independent error/loading state. Dashboard keeps one timer per resource family, resynchronizes that timer and triggers a fresh guarded read when the corresponding display/interval preference changes, and uses `Promise.allSettled` for the unrelated initial management reads so one failed request does not abort Dashboard setup.

**Status:** PASS.

### GREQ-DASH-004 — Configured SSH resource snapshots preserve host identity/cache timing and first-sample CPU fidelity

**Git/final-baseline evidence:** `6f92747c` moved Dashboard remote resources from active Workspace sessions to configured SSH hosts, de-duplicates by normalized `host:port`, tries duplicate credentials as fallbacks, limits collection to four hosts concurrently and takes a second CPU sample after 500 ms on first discovery because the first `/proc/stat` sample only establishes a delta baseline. `2865f455` makes connection configuration part of cache identity; `9fc09fa9` / `86a8e6af` make the independent Settings refresh interval part of cache timing/identity; `bcff7097` measures TTL from collection start so a 30-second start-to-start Dashboard poll does not accidentally become an effective 60-second refresh.

**Required behavior:** one configured remote host appears once per normalized host+port even if several saved Connections target it; duplicate records provide credential fallback rather than duplicate cards. Collection remains bounded to four concurrent hosts. Cache identity changes immediately when relevant connection configuration or the remote refresh interval changes, TTL is measured from collection start, and the first successful discovery takes a short second status sample so Dashboard does not report an artificial 0% CPU solely because the collector had no prior delta baseline. Later low-frequency refreshes need only one sample while the collector retains that host baseline.

**Old-design review:** all remote probing/cache/sample policy belongs in Backend `SshResourceStatusService`; the generic `PosixServerStatusCollector` correctly returns 0 on a first baseline sample and should not globally sleep/double-sample for Status Monitor or other consumers. Settings remains the refresh-interval owner. Frontend only renders the clean snapshot model.

**Refactored design/implementation:** the clean Backend keeps its existing host:port de-duplication, credential fallback, four-way concurrency, connection+refresh fingerprint identity and collection-start TTL. `SshResourceStatusService` now also owns the final-old first-discovery bootstrap: after the collector establishes a host CPU baseline, the service waits 500 ms and takes one second sample, while later snapshots use the retained collector baseline and a single collection.

**Status:** PASS.

### GREQ-DASH-005 — Resource snapshots retain CPU, memory and root-disk content

**Git/final-baseline evidence:** `c270b5e0` introduced the configurable local/remote resource overview with CPU, memory and disk values. The later `3f316a49` metric refinement and final `DashboardView.vue` keep all three remote metrics reachable and retain remote memory used/total context in addition to its percentage; the local resource summary likewise retains CPU, memory and root-disk usage.

**Required behavior:** a successful configured-SSH resource snapshot must not be reduced to CPU and memory only. Dashboard keeps CPU, memory and root-disk usage observable for each remote host, with unavailable disk values rendered explicitly rather than fabricated as 0. Memory usage may expose both percentage and used/total capacity. Local resource presentation likewise retains its three core CPU/memory/root-disk values.

**Old-design review:** this is presentation of the existing clean `ResourceStatus` model, not a new metric owner. Backend System already collects and maps disk/memory values; Dashboard only formats those fields for the user.

**Refactored design/implementation:** the clean Dashboard now renders the existing remote `ResourceStatus` CPU, memory percentage, memory used/total capacity and root-disk percentage, with non-finite/unavailable values shown as `—` rather than coerced to a false 0%. The local card continues to expose the same three core resource families.

**Status:** PASS.

### Dashboard residual presentation audit — no separate GREQ

- `2983b036` and `2853e3f2` align/enlarge the two old desktop scroll panels. Equal pixel heights are presentation policy rather than a standalone capability. The clean page is not required to recreate those exact panel dimensions as long as connection/resource content remains reachable.
- `a21f361d` proves a real narrow-screen reachability constraint: no page-level horizontal overflow, full-width search, reachable tag/sort/order controls and a full-width/tappable connection action. The current clean Dashboard already uses min-width-safe grid columns, a full-width mobile search row, wrapping resource cards and a full-width mobile connect action, so this behavior is retained without reopening a new gap.
- `0a9c62c8` changed only how the initial empty remote loading block fills its scroll panel; the lifecycle requirement is captured in `GREQ-DASH-003`, while the exact old background/height styling is not separately cataloged.

## Terminal

### GREQ-TERM-001 — Stable xterm input/output, resize and shell-facing semantics

**Git evidence:** the final `Terminal.vue`, `73229fa6`, `f31d5280`, `44b19dd5`, and the late SSH-input/resize stabilization changes.

**Required behavior:** terminal output is rendered in order, user input is forwarded without being transformed by UI controls, input scrolls the viewport to the bottom, remote newline rendering uses the product's final `convertEol` behavior, and terminal resize is sent only when effective columns/rows actually change. The interactive cursor remains a stable block cursor. Clean Workspace terminal output is raw binary/text output and does not expose the old per-frame acknowledgement contract to the Terminal feature.

**Old-design review:** the old component mixed event-bus transport, session lookup, xterm rendering and resize policy. Per-frame ACK concepts also belonged to the old transport framing rather than the reusable Terminal capability.

**Refactored design/implementation:** `TerminalView` owns xterm rendering only; `TerminalChannel` owns input/output/resize capability and has no legacy ACK method. Workspace adapter owns the raw clean socket. Resize de-duplicates identical cols/rows before crossing the port.

**Status:** PASS.

### GREQ-TERM-002 — Incremental terminal search and decoration lifecycle

**Git/final-baseline evidence:** final `CommandInputBar.vue`, `WorkspaceView.vue`, `Terminal.vue` and `FR-TERM-009` behavior.

**Required behavior:** search text is incremental, next/previous navigation remains available, search never becomes shell input, and closing/clearing search removes SearchAddon decorations. Search state survives presentation remounts for the same Workspace session.

**Old-design review:** the legacy implementation split search term/control state across CommandInputBar, Workspace event-bus handlers and Terminal manager methods.

**Refactored design/implementation:** Terminal feature owns SearchAddon plus session-scoped `searchOpen/searchTerm` in `TerminalSessionState`. Workspace only exposes focus/composition; no cross-feature search store or event bus is restored.

**Status:** PASS.

### GREQ-TERM-003 — Clipboard shortcuts, right-click copy/paste and mobile selection

**Git evidence:** `c3470a54`, `5f536d1a`, `9f6597ce`, the 2026 mobile-selection fixes, and the user-directed replacement recorded in `GREQ-PREF-004`.

**Required behavior:** Ctrl/Cmd+Shift+C copies the current selection and Ctrl/Cmd+Shift+V pastes normalized clipboard text without forwarding those shortcut keystrokes to the PTY. The current right-click copy/paste preference is one default-on switch: selected text is copied and the selection is cleared/focused; with no selection, right-click pastes through xterm so bracketed-paste semantics remain intact. Mobile long-press selection exposes exact-copy/select-all/paste controls and is independent of the retired auto-copy-on-select behavior.

**Refactored design/implementation:** Terminal uses the shared browser clipboard write compatibility primitive but owns xterm-specific selection/paste semantics. Historical auto-copy is removed through versioned settings migration rather than left as a dormant prop.

**Status:** PASS.

### GREQ-TERM-004 — Font scaling, visual background and OSC background protection

**Git evidence:** `4c4f9451`, `5787b160`, `5a4049b3`, `a4893e56`, `2ae25c35`, `1c56b9f7` and final Terminal appearance behavior.

**Required behavior:** Ctrl+wheel and mobile pinch scale terminal font within the supported range, the newest value is persisted even if the Workspace closes while a debounce is pending, desktop/mobile font settings remain distinct, image/HTML backgrounds keep xterm transparent, and remote OSC 11/111 background-color changes cannot turn a configured visual background opaque. OSC 11 queries remain available to xterm.

**Old-design review:** appearance/store watchers and persistence locks lived directly inside the old Terminal component.

**Refactored design/implementation:** Terminal owns only immediate xterm visual application and emits font-size intent. Workspace composition persists the latest value through one `createLatestValueSaver` and flushes it on lifecycle changes. OSC interception uses xterm's public parser API only; `_core` remains unused.

**Status:** PASS.

### GREQ-TERM-005 — Terminal remount and suspend snapshot continuity

**Git evidence:** `44b19dd5`, final `terminalSnapshot.ts`, late suspend/remount fixes and the final Workspace suspend handoff.

**Required behavior:** changing mobile panes/layout presentation must not erase the terminal screen that was already rendered. Suspend marking may include an ANSI terminal snapshot, but the snapshot is bounded to roughly 1 MiB and preferentially drops older scrollback while preserving recent output. Output that arrives while no TerminalView is mounted is buffered and replayed after the saved snapshot. Resume continues from the Backend suspended log/transport without duplicating the same snapshot.

**Old-design review:** the legacy Session mega-store stored pending output/snapshots and component-detach events, which coupled xterm presentation to Workspace transport state.

**Refactored design/implementation:** `features/terminal` owns `TerminalSessionState` and bounded public-API serialization. `WorkspaceRuntimeSession` retains one feature-state instance for its lifetime but never interprets xterm state. `TerminalView` captures on unmount/replays on mount, while the Workspace terminal adapter independently buffers output received while no output handler exists. Renderer refs are watched so imperative Terminal API references are cleared/replaced on real mount transitions.

**Status:** PASS.

### GREQ-TERM-006 — Terminal interaction can interrupt reconnect backoff

**Git evidence:** `73229fa6` and final Workspace reconnect behavior.

**Required behavior:** once a Workspace has connected successfully, real terminal interaction may interrupt reconnect backoff. First-handshake readiness still prevents command-bar input from being silently lost before a connection has ever succeeded. Empty Enter on a disconnected established session requests immediate reconnect and scrolls the terminal to the bottom.

**Refactored design/implementation:** Terminal and Command Bar emit interaction intents; `WorkspaceRuntimeSession.reconnectNow()` owns reconnect scheduling. UI features never inspect or manipulate the WebSocket directly.

**Status:** PASS.

## Filesystem / File Manager

### GREQ-FS-001 — Session-scoped initial directory and cwd recovery

**Git evidence:** final FileManager initial `realpath('.')` flow, `9f69ef71`, `704511ce`, and the late shell-path integration fixes.

**Required behavior:** the first File Manager for a Workspace resolves `.` to the remote user's actual working/home directory rather than assuming `/`. Embedded and popup presentations share that one resolved cwd. Refresh recovers from an externally deleted cwd by walking upward to the nearest readable parent instead of leaving File Manager unusable.

**Old-design review:** the old component ran its own realpath request/listeners and readiness watchers, so multiple FileManager instances could duplicate initialization work.

**Refactored design/implementation:** `FilesystemSessionState` owns one initial realpath/load and path-history side effect for the Workspace-session lifetime. Presentations consume the same state; failed relative-path resolution safely falls back to `/`.

**Status:** PASS.

### GREQ-FS-002 — Desktop/touch open semantics, selection and Explorer-style keyboard control

**Git evidence:** `9e6f195e`, `4eaae312`, `b987b5d6` and final keyboard/selection composables.

**Required behavior:** desktop normal click owns selection, desktop files open on double-click, directories retain direct navigation, and touch/mobile uses tap-oriented behavior outside multi-select mode. Keyboard navigation wraps with ArrowUp/ArrowDown and Enter activates the highlighted row. Ctrl/Cmd+A/C/X/V, Ctrl/Cmd+Shift+N, Delete, F2, F5 and Alt+ArrowUp retain their final Explorer-style meanings, including physical keyboards on tablets/mobile.

**Old-design review:** keyboard index state, filename-based selection and action callbacks were split across several old composables.

**Refactored design/implementation:** `useFilesystemBrowser` is the single selection owner, including `selectAll()`. `FileManager` maps keyboard gestures onto existing browser mutations and clipboard/mutation intents; there is no second filesystem-operation implementation.

**Status:** PASS.

### GREQ-FS-003 — Context-menu target scope and multi-selection semantics

**Git evidence:** `151b3565`, `32e5ba71`, the final `useFileManagerContextMenu.ts`, and later live-action fixes such as `4a68a23f`/`4d57a956`.

**Required behavior:** right-clicking an already-selected row keeps the selection and batch-capable actions act on the full selected set; right-clicking an unselected row without selection modifiers makes it the single target. Copy/Cut/Download/Send Files/Compress/Delete may act on the resolved selection, while Open/Rename/Chmod/Copy Path/Paste-into-directory/Decompress remain target-specific. Empty current-directory context provides Paste/New Folder/New File/Upload/Refresh. Parent-directory context provides Paste-to-parent and Refresh. Mobile long-press opens the same action semantics.

**Old-design review:** the legacy menu generated a large mutable menu tree and represented `..` as a fake file item.

**Refactored design/implementation:** current `BaseContextMenu` uses an explicit scope union (`entry`, `current-directory`, `parent-directory`). All actions reuse the same existing Filesystem/Transfers intents; no fake parent file model or duplicate operation service exists.

**Status:** PASS.

### GREQ-FS-004 — Symlink resolution and force-open-as-text intent

**Git evidence:** `e1ecb5d0`, `997fa285`, final symlink/open-as-text behavior and Markdown preview additions such as `5a701f2c`.

**Required behavior:** opening/downloading symbolic links follows the actual target type and stale/broken resolutions fail locally without corrupting File Manager state. Markdown/Markdown symlinks normally remain previewable, but the context menu offers `Open as text` to force the File Editor path.

**Old-design review:** old FileManager subscribed directly to realpath WebSocket success/error message names and opened Editor/Preview directly.

**Refactored design/implementation:** Filesystem feature owns a clean `realpath` capability and emits `openFile`/`openAsText` intents. Workspace composition selects Preview versus Editor, preserving feature boundaries.

**Status:** PASS.

### GREQ-FS-005 — Favorite paths and path history behavior

**Git/final-baseline evidence:** final `favoritePaths.store.ts`, `pathHistory.store.ts`, `FavoritePathsModal.vue`, and the path-history/favorite commits in the old UI lineage.

**Required behavior:** Favorites support search, add/edit/delete, name-vs-last-used sorting, persistent sort preference, navigation, last-used updates and sending a favorite path to the owning terminal. A failure to update last-used metadata must not block navigation. Path History records successful navigation, shows newest first, filters, supports inline keyboard selection, Copy/Delete/Clear and can navigate back to an entry.

**Old-design review:** separate global Pinia stores duplicated loading/error/search state and mixed notifications into data mutation.

**Refactored design/implementation:** one Filesystem catalog owner holds canonical favorite/history records; individual presentations own only their search/dropdown UI state. Favorite sort remains a browser presentation preference. Session state records navigation once so embedded/popup FileManagers do not duplicate HTTP writes.

**Status:** PASS.

### GREQ-FS-006 — Exact Workspace-scoped download behavior

**Git evidence:** `725c73bd`, `b34d7b0b`, `45ba5c1f`, `e1ecb5d0` and the final download-ticket implementation.

**Required behavior:** file/directory downloads are bound to the exact current authenticated Workspace session rather than guessed from connection id. File download tickets are short-lived and invalidated if the remote file changes; directory download streams a server-generated archive rather than first buffering the archive in browser memory. Symlink downloads follow the resolved target.

**Refactored design/implementation:** `FilesystemDownloadPort` receives the runtime workspace id and connection id and hides current HTTP mechanics from FileManager. Backend download tickets bind user, connection, workspace, path, size and mtime. The historical `/sftp` route name is still an Interface migration item, not Filesystem business state.

**Status:** PASS.

### GREQ-FS-007 — Remote drag-to-move and external drop intake

**Git evidence:** final `useFileManagerDragAndDrop.ts`, `32e5ba71`, `d08e1493` and the later multi-file/drop stability fixes.

**Required behavior:** desktop remote rows can drag the current selection onto another directory or the parent destination to perform the existing same-session move. External browser drops snapshot all available files/directories before asynchronous processing, preserve relative directory structure, support empty files/directories and do not confuse an internal remote drag with an external upload.

**Old-design review:** old FileManager drag composable owned both browser DataTransfer traversal and transfer execution state.

**Refactored design/implementation:** Filesystem presentation only resolves drop inputs and emits `moveTo` or `uploadFiles`; Transfers remains the only transfer/task owner. Directory collection is isolated in `collectDroppedLocalFiles`.

**Status:** PASS.

### GREQ-FS-008 — Recursive filename search with stale-result protection

**Git evidence:** `4d4d8728` introduced recursive File Manager search and `bcff7097` fixed request/resource regressions. Final old `FileManager.vue` debounces query changes, rejects stale responses when the query/path/manager changes, refreshes an active search after directory content changes and preserves the Backend truncation flag.

**Required behavior:** a non-empty File Manager search recursively finds matching names below the current directory rather than only filtering the loaded directory. Live typing is debounced. Results from an older query or old root must never replace the current view. Clearing search immediately reveals the retained current-directory listing. Search results retain relative-path context for duplicate basenames. Backend result capping remains visible through the “first 500 matches” warning.

**Old-design review:** final old UI kept search request tokens, recursive result arrays and content-revision watchers directly inside the large FileManager component. The race-prevention behavior is required, but request lifecycle belongs with the Filesystem browser/session owner rather than each presentation.

**Refactored design/implementation:** `FileSearchEntry` explicitly carries `relativePath`. `useFilesystemBrowser` owns separate directory/search collections, 250 ms live-search scheduling, stale query/root tokens, truncation/error state and active-search refresh after successful directory loads/mutations. `FileManager` only renders the clean state and relative result path.

**Status:** PASS — architecture/i18n/Vue typecheck and `git diff --check` pass for this slice.

### GREQ-FS-009 — Large directory/search-result virtualization without logical-state loss

**Git/final-baseline evidence:** `e745e176` added demand-driven File Manager rendering. The final old implementation virtualizes lists above 250 rows, keeps 12 rows of overscan, estimates row height from the current row scale, tracks viewport size and scrolls keyboard targets into the rendered window.

**Required behavior:** directories and recursive search results with hundreds of rows must not require one live DOM row per remote entry. Virtual rendering must remain an implementation detail: sorting, keyboard navigation, selection, drag scope and actions continue to operate on the complete logical result set. Changing path/search/sort resets the virtual viewport, and keyboard navigation can focus rows that were initially outside the rendered window.

**Old-design review:** virtualization is presentation policy, not Filesystem business/session state. Moving its offsets into the Filesystem owner would couple reusable state to one table implementation.

**Refactored design/implementation:** `FileManager` owns the 250-row threshold, 12-row overscan, scaled row-height estimate, viewport ResizeObserver and top/bottom spacer rows. `useFilesystemBrowser.visible` remains the complete sorted logical list, so capability semantics do not depend on virtualization.

**Status:** PASS — architecture/i18n/Vue typecheck and `git diff --check` pass for this slice.

### GREQ-FS-010 — Safe bidirectional Terminal/File Manager current-directory coordination

**Git evidence:** `8a827305`, `9226444d`, `617f2099`, `9f69ef71`, `704511ce` and the final shell-path integration.

**Required behavior:** File Manager can synchronize itself to the owning interactive Terminal cwd and can request that the owning Terminal change to a File Manager/favorite path. Reading cwd must not print probe traffic into the terminal. A requested `cd` must never be injected into a foreground program: supported shells queue it until a prompt is available, report the waiting state, resolve/validate the target first and report success only after the shell is verified at the requested directory. A newer pending change supersedes the previous one. Deleted cwd recovery walks to an existing parent rather than leaving File Manager stuck.

**Old-design review:** the final old component subscribed directly to `ssh:exec_silent:*` / `ssh:change_directory:*` messages and manually correlated request ids. Filesystem transport also temporarily carried Terminal-specific methods. Both leak Workspace/Shell protocol details into the Filesystem UI.

**Refactored design/implementation:** Backend `WorkspaceShellIntegrationService` owns shell probing, prompt hooks, safe queued changes and deleted-cwd recovery. Frontend `FilesystemChannel` is again filesystem-only. A narrow `TerminalDirectoryPort` expresses the actual File Manager dependency. The Workspace adapter correlates queued/result/error protocol events into a clean completion Promise plus a presentation-neutral queued callback; File Manager reports waiting state and only shows success after verified completion. Operation-local busy state prevents accidental duplicate submissions.

**Status:** PASS — architecture/i18n/Vue typecheck and `git diff --check` pass for this slice.

### GREQ-FS-011 — Empty-directory upward navigation remains reachable

**Git evidence:** `4eec3177` fixed the final old File Manager so an empty non-root directory still exposed its parent (`..`) entry instead of presenting only an empty-state row.

**Required behavior:** an empty directory must never strand navigation. Users must retain an obvious, keyboard-reachable way to move to the parent directory, including when a search returns no rows. Root is the only path with no meaningful parent transition.

**Old-design review:** the legacy table represented `..` as a synthetic file row and had to special-case the empty-table branch. The synthetic file object is not itself a requirement.

**Refactored design/implementation:** current File Manager exposes a dedicated parent-directory control outside the data rows and includes that control in keyboard navigation for non-root paths. It therefore remains available even when the current directory/search result set is empty, without fabricating a `RemoteFileEntry`.

**Status:** PASS.

### GREQ-FS-012 — File actions recover live after session/reconnect and non-fatal operation errors

**Git evidence:** `4d57a956` and `4a68a23f` fixed stale File Manager readiness captured when a context menu was opened or when the active Workspace session changed.

**Required behavior:** a transient reconnect or non-fatal protocol/operation failure must not permanently disable File Manager actions. Switching away from and back to a Workspace must use that session’s current live capability state rather than a copied readiness snapshot. A generic operation error is not equivalent to the underlying SSH/filesystem transport being dead.

**Old-design review:** old context menus captured `isConnected` / `isSftpReady` booleans and old session wiring sometimes converted unrelated generic errors into permanent SFTP-unready state. Patching each menu item with reactive closures was necessary only because readiness leaked into presentation construction.

**Refactored design/implementation:** each `WorkspaceRuntimeSession` owns its live socket/adapters and Filesystem session state. File Manager actions call the current capability instead of caching transport-readiness booleans in menu models. Workspace generic/protocol errors update status feedback without rewriting Filesystem business state into a dead presentation snapshot; real disconnect/reconnect remains runtime lifecycle state.

**Status:** PASS.

### GREQ-FS-013 — Narrow-pane File Manager controls remain reachable

**Git/final-baseline evidence:** `c5885db3`, `992d5060`, `64f65192`, `90c93e59`, `d8272612` and later toolbar simplification retained a container-width-aware File Manager toolbar so path/search/core actions remained usable in narrow layout panes and mobile presentations.

**Required behavior:** File Manager controls must adapt to the actual pane width rather than assuming a desktop viewport. Narrow panes may wrap or compact controls, but Refresh, parent navigation, Terminal-directory sync, Favorites, New Folder/New File, Upload and mobile multi-select must remain reachable rather than being clipped away.

**Old-design review:** exact historical icon classes, grid column counts and container-query breakpoints are presentation implementation details, not product ownership.

**Refactored design/implementation:** the current toolbar is a wrapping, min-width-safe pane-local flex layout; actions remain in normal flow instead of an overflowing fixed toolbar. Mobile/touch adds its dedicated multi-select control. No action is removed merely because the pane is narrow.

**Status:** PASS.

### GREQ-XFER-001 — Upload integrity, directory preparation, conflict policy and isolated bounded transport

**Git/final-baseline evidence:** `54631416` fixed upload corruption caused by estimating raw byte offsets from Base64 length and moved success after the remote write had actually flushed; `8e3c3e05` corrected folder-relative paths and empty-file upload; `2163d4d3` added whole-directory-tree preparation before file streams start; `d08e1493` added explicit same-name conflict handling and weak-network bounded upload flow; `f59102f3` improved folder-upload scheduling/throughput; `7cb59b88` bounded browser-side upload backlog so cancel/refresh control traffic remained responsive; `f0ea3aef` then isolated upload data from File Manager/control traffic; `5b04dc00` rebalanced the dedicated upload WebSocket buffering after that isolation. The final old frontend kept those semantics even though its wire protocol still used NXUP frames/ACKs.

**Required behavior:** uploading files or folders must preserve exact bytes and relative paths, support zero-byte files, create the required remote directory tree before dependent file streams begin, surface `ask` / `overwrite` / `skip` conflicts, keep browser/server buffering bounded under slow links, allow cancellation to stop producing bytes promptly, and prevent bulk upload traffic from head-of-line blocking Terminal/File Manager control operations. A completed task is reported only after the backend has flushed and verified the final remote file.

**Old-design review:** NXUP framing, Base64-era offset accounting, per-chunk ACK RTT/EWMA tuning and the old shared WebSocket/SFTP manager are historical transport mechanisms, not requirements. After the clean runtime moved upload bytes to one raw `/ws/uploads` socket per active file and Backend moved transfer I/O onto the `RemoteFileSystemRole = 'transfer'` channel, reproducing the old ACK algorithm would add protocol complexity without preserving additional product behavior.

**Refactored design/implementation:** `TransferController` owns logical upload tasks/batches/conflict UX; the Workspace transfer adapter owns upload start/prepare protocol, bounded raw-file streaming and active-file scheduling; Backend `StreamUploadOperationService` validates ordered chunks and declared size, writes to a private `.part` file, verifies its size and replaces the destination only on successful finalization; `SshSftpChannelPool` isolates the `transfer` filesystem role from control filesystem operations. One raw `/ws/uploads` socket is used per active file, browser and server queues are bounded, and abnormal data-stream closure routes through Backend abort cleanup instead of leaving a ghost `.part`/running task. Main-Workspace reconnect semantics are accounted for separately but consistently under `GREQ-XFER-002`.

**Status:** PASS.

### GREQ-XFER-002 — Workspace reconnect pauses uploads and safely restarts them from byte zero

**Git/final-baseline evidence:** `d08e1493` introduced the weak-network upload scheduler/conflict state, while the final old `useFileUploader.ts` explicitly marked pending/running uploads `paused` when the main Workspace connection became unavailable, invalidated prepared-directory/ACK state, re-prepared the complete directory tree after reconnect and restarted each unfinished file from byte zero. `f0ea3aef` additionally separated the upload data transport from the main control transport, so a failure of only that data channel was treated as an upload failure rather than a Workspace reconnect.

**Required behavior:** if the main Workspace connection drops, unfinished upload tasks must not remain falsely `running` or be reported as user-cancelled. They pause, stale remote preparation/stream state is discarded, and after Workspace reconnection the directory preparation is replayed and unfinished files restart safely from byte zero. If only one dedicated upload data socket fails while the Workspace control connection remains healthy, that file fails explicitly and its backend temporary upload is cancelled/cleaned; it is not retried forever. User cancellation remains distinct from either transport failure.

**Old-design review:** reconnect recovery belongs neither in File Manager presentation nor in a global legacy progress/session store. `TransferController` should retain transport-neutral logical task state; Workspace runtime/adapter owns knowledge of connection availability, request replay and `/ws/uploads` transport lifetime. Backend owns temporary-file cleanup when an incomplete upload data stream disappears.

**Refactored design/implementation:** `TransferStatus` includes `paused`, and the clean transfer event model has `paused` / `resumed` transitions. `TransferController` preserves the logical task while clearing stale progress when the adapter restarts the file. The Workspace transfer adapter retains active upload and prepare intents, marks them paused on Workspace disconnect, closes stale data sockets, replays directory preparation after the clean Workspace connection is re-established and requeues each unfinished file from byte zero. `WorkspaceRuntimeSession` does not publish `connected` until capability recovery has completed and the control socket is still connected. If only one `/ws/uploads` stream fails while Workspace remains healthy, the adapter emits a real upload error and asks Backend to abort; Backend transport close/error cleanup aborts incomplete upload state and removes the temporary file. User cancel remains a separate explicit path.

**Status:** PASS.

### GREQ-XFER-003 — Copy/move supports cross-Workspace semantics, long-running progress and cancellation-confirmed terminal state

**Git/final-baseline evidence:** `341b764c` introduced a shared file clipboard and cross-host copy/cut semantics; cross-host cut performs a destination copy first and deletes the source only after copy success, reporting a warning/partial outcome if source deletion fails. `61aff2e0` added correlated transfer progress and long-running copy tracking. `764f2802` fixed remote move destination existence handling. `3a347a66` made cancellation remain attached to the real transfer lifecycle instead of expiring/pretending completion while an SFTP read/write was still blocked. The final old frontend used a 30-minute copy timeout and kept progress/cancellation driven by correlated transfer events.

**Required behavior:** same-Workspace copy/move and cross-Workspace copy must expose progressive file/byte state and remain cancellable for operations longer than the normal request timeout. Cross-Workspace cut is a composed copy-then-source-delete operation: the source must never be deleted before destination copy success, and source-delete failure becomes a partial result rather than a false successful move. Copy retains the clipboard; a completed cut clears only the clipboard generation that initiated that operation. Symlink copy follows the target behavior established by the SFTP transfer implementation. Cancellation is not terminal merely because the cancel request was accepted: non-upload copy/move remains `cancelling` until Backend emits correlated `cancelled`. A Workspace disconnect must not leave a ghost `running` transfer, and remote copy/move is not blindly replayed after reconnect because it may already be partially applied.

**Old-design review:** the old global Pinia file clipboard and pane-local `useSftpActions` transfer dictionaries are not required owners. The durable clipboard is a Workspace-registry composition concern; the logical task belongs to Transfers; source deletion for cross-host cut is composition across target transfer + source Filesystem. Transport request ids, event names and disconnect behavior remain in the Workspace adapter.

**Refactored design/implementation:** `workspaceRuntimeRegistry.fileClipboard` owns the cross-session clipboard snapshot/generation. `WorkspaceView.pasteFileClipboard()` chooses same-session move versus copy, waits for the correlated target task before cross-session source deletion and marks source-delete failure `partial`. `TransferController` owns task/progress/waiter/cancelling state. Clean Backend transfer operations emit progress/completed/failed/cancelled events. The clean Workspace protocol immediately acknowledges copy/move start instead of awaiting the whole operation under the generic 30-second request timeout; all terminal results are delivered by correlated events. Start uses the task id as its correlation request id, but cancellation now carries `taskId` as business payload under a fresh transport request id, so a running task no longer occupies/collides with the pending-request key needed to cancel it. The Workspace adapter sends only the cancel command appropriate to the tracked task kind and ends non-replayable remote operations explicitly on disconnect instead of leaving ghost tasks.

**Status:** PASS.

### GREQ-XFER-004 — Archive progress, cancellation cleanup, valid-warning preservation and password-protected ZIP retry

**Git/final-baseline evidence:** `52b79783` added File Manager compress/decompress actions; `f637ce14` and `2c749f64` added active progress, file counts and percentage; `f5b171c9` made archive cancellation a real long-running workflow; `5299eda8` ensured cancelled jobs stop rendering as active and temporary archive output is cleaned; `db41df55` preserved a valid ZIP when the remote `zip` command exits with a warning; `fd75db5c` added password-protected ZIP creation/extraction plus password validation and retry UX; `946b7e78` preserved Unicode names while extracting ZIPs; `2e3204ab` kept archive progress lifecycle registered independently of pane presentation; `c680e61e` removed the old 30-second cancellation marker and kept cancellation attached to the actual archive preflight/command lifetime; `5be4de84` guarded the old single-object archive progress state from overlapping requests.

**Required behavior:** ZIP / tar.gz / tar.bz2 compression and extraction are correlated long-running tasks with progress and cancellation. Compression writes to temporary output and only replaces the requested destination after successful finalization; cancellation/failure removes temporary output. A ZIP that is structurally valid after a warning exit is kept and reported as a warning/partial outcome rather than discarded as a hard failure. ZIP password protection supports create/extract, rejects overlong or line/NUL-containing passwords, distinguishes password-required from invalid-password, and lets the user enter/retry the password without losing the archive operation context. Passwords are not supported for tar formats. ZIP extraction preserves Unicode filenames. Archive commands longer than the generic Workspace request timeout must keep running through event-driven progress, and accepted cancellation is terminal only when Backend emits the correlated cancelled event.

**Old-design review:** the old `ArchiveProgressPopup`, `ArchivePasswordModal` and pane-local archive state are presentation mechanisms, not owners. Archive execution/error classification belongs in Backend Platform; logical task/progress/error code belongs in Transfers; the Workspace surface owns only the transient password-entry presentation and request context needed for retry. Password-required/invalid-password must remain a typed code across the clean boundary instead of being inferred from localized error text. The `5be4de84` one-archive-at-a-time guard protected an old single `archiveProgress` object; it is not a product requirement and is superseded by request-keyed Backend archive operations plus independent `TransferTask`s, so the clean runtime does not artificially serialize unrelated archive jobs.

**Refactored design/implementation:** Backend `RemoteArchiveOperationService` uses a private `.nexus-archive-<request>.part*` path for compression, removes it in `finally`, validates a warning ZIP with `zip -T` before preserving it, emits structured `ArchiveErrorCode`, supports only ZIP passwords, and extracts ZIPs under an available UTF-8 locale. The clean Workspace protocol immediately acknowledges archive start and sends progress/completed/failed/cancelled through `transfer.archive`, avoiding the generic 30-second request timeout. As with copy/move, archive cancellation now carries the archive `taskId` in payload under a fresh transport request id rather than reusing the task id as a second pending request, eliminating cancellation-key collisions. `ArchiveEventWire.code` is projected into `TransferTask.errorCode`; the Workspace surface closes the input after start, waits on the session-owned task, and reopens the integrated archive password form for `PASSWORD_REQUIRED`, `INVALID_PASSWORD`, `PASSWORD_TOO_LONG` or `INVALID_PASSWORD_FORMAT`, showing the appropriate retry error without restoring the legacy modal/store. Archive completion warnings are forwarded into the generic transfer partial state.

**Status:** PASS.

### GREQ-XFER-005 — Progress survives pane remount, can be hidden/restored centrally, and new tasks become visible again

**Git/final-baseline evidence:** `45a48f35` centralized long-running upload/copy/archive providers into a shared progress registry; `622aa7f6` centralized hidden progress controls and made archive decompression cancellable from the same surface; `578f4b28` and `fe10aae0` unified per-popup hide behavior; `2e3204ab` explicitly detached archive task lifetime from File Manager presentation lifetime; `e060a2ea` preserved an explicit Hide made before the provider's first task sync while still resurfacing genuinely new work; `82ab03f0` closed the central progress list when restoring a hidden popup; `3c9d2ba4`, `1c74769d` and `4872c21a` made active transfer progress readable, movable/resizable and viewport-safe. The final progress registry reset a hidden provider when a genuinely new task appeared, so an earlier manual hide never made future work permanently invisible.

**Required behavior:** upload/copy/move/archive task state must outlive File Manager pane, sidebar, popup and mobile presentation remounts. The user may hide a session's progress card without cancelling work, inspect all hidden progress centrally, cancel a task/source from the central view, and restore the session card. A newly-created task for a previously hidden session becomes visible automatically. Hiding/minimizing presentation must never detach the task owner or stop event processing. Completed/error/partial tasks remain inspectable until the user removes them.

**Old-design review:** the old global progress-provider registry plus `deferCleanupUntilIdle()` existed because task state was owned by pane-local upload/SFTP composables. In the clean runtime, adding another progress store would duplicate the real owner. `WorkspaceRuntimeSession.transferController` already has the correct lifetime; Workspace view only needs presentation visibility and aggregation across live sessions.

**Refactored design/implementation:** each `WorkspaceRuntimeSession` constructs one `TransferController`; `WorkspaceSessionSurface` renders its progress card but remounting File Manager/sidebars does not recreate the controller. `WorkspaceView` derives hidden `ProgressSource`s directly from every session controller, and `ProgressDisplayModal` delegates cancel/remove/restore back to the owning controller and closes when a source is restored. `progressVisibility[sessionId]` is presentation-only. Because a clean task is inserted into the session controller before its progress presentation exists, the old provider-registration race from `e060a2ea` no longer exists; an explicit Hide acts on an already-owned task. A task-id watcher detects later genuinely new tasks and resets that session's hidden flag to visible. The single clean `ProgressCenter` uses shared drag/resize primitives, clamps to the viewport and persists position/size, superseding the old separate upload/copy/archive popup geometry while preserving the final interaction requirements. The shared resize primitive now accepts dynamic minimums so the normal 340×190 progress minimum shrinks to the actual viewport allowance on narrow screens instead of overflowing a sub-356px mobile viewport.

**Status:** PASS.

### GREQ-XFER-006 — Send Files creates independent multi-target server-transfer tasks with grouped target selection and central progress

**Git/final-baseline evidence:** `c91e44cb` introduced Send Files plus asynchronous `/transfers/send` tasks, status inspection and the transfer progress UI; `9be252bf` moved execution to the selected source server and expanded source/target SSH credential handling; `e97500cb` limited selectable targets to SSH and made rows directly selectable; `f44bbe3e` added tag-aware search and collapsible target groups; `269131a3` made groups default expanded; `b91f8dfd` opened transfer progress immediately after task creation. The later `d3b0f40a` orchestration refactor retained the rsync/scp strategy selection, temporary-key cleanup, cancellable subtasks and background task registry while separating executor/orchestrator/task ownership.

**Required behavior:** selected files/directories on one SSH connection can be sent to one or many other SSH connections. Targets are grouped by tags (with untagged fallback), searchable by tag/connection name, selectable individually or by group, and groups default expanded but can be collapsed. The source connection itself and non-SSH targets are excluded. The user chooses target path and `auto` / `rsync` / `scp`; auto prefers rsync when supported by source and target and falls back to scp. Initiation returns an asynchronous task rather than waiting for transfer completion, immediately opens central progress, exposes per-target/per-item subtask progress/method/error, and supports cancelling active tasks and removing final task records. Target credentials and temporary source-side key material are cleaned up by Backend; task visibility is authorized by the initiating user.

**Old-design review:** server-to-server Send Files is not a live Workspace `TransferController` operation. It is keyed by stored connection IDs, creates a system-owned source execution session and can outlive the source Workspace presentation. Forcing it through Workspace WebSocket adapters would reduce lifetime correctness. The independent clean HTTP `serverTransfersApi` + `serverTransfers.store` therefore remains a justified Transfers sub-owner, while the Workspace view only composes its progress tasks with live-session progress.

**Refactored design/implementation:** `SendFilesModal` uses clean Connections/Tags owners, current Transfers HTTP store and typed request/task models. The tag groups have regained the final-old default-expanded collapse/expand behavior while keeping current visible-selection/clear controls. Successful `sent` bubbles only as a presentation event through `WorkspaceSessionSurface`; `WorkspaceView` opens its existing `ProgressDisplayModal`, avoiding the old global workspace-event bus. `useServerTransfersStore` polls the authenticated clean `/transfers` Interface, maps server tasks into generic progress tasks and delegates cancel/remove. Backend `TransferOrchestratorService` owns multi-subtask concurrency and a system execution session; `ServerTransferExecutor` owns rsync/scp capability checks, target directory creation, credential command construction, transfer-channel temporary key cleanup and command cancellation.

**Status:** PASS.

### GREQ-EDIT-001 — Encoding changes reinterpret the loaded bytes; Refresh is the explicit remote reread; save preserves the chosen encoding and line ending

**Git/final-baseline evidence:** `679d38f5` fixed editor garbling by retaining the raw remote bytes and decoding them explicitly; `53249947` added manual encoding selection; `166249ed` normalized UTF-16 decoder labels; `6e9c08a1` added an explicit force-refresh action for rereading the remote file; `5e489a7b` added LF / CRLF / CR conversion. In the final old editor, a normal encoding change re-decoded the tab's stored `rawContentBase64`; it did not silently fetch newer remote contents. Refresh was the distinct operation that reread the file, replaced the raw snapshot/content/detected encoding and reset modified state after an unsaved-change confirmation. Save encoded the current text with the selected encoding.

**Required behavior:** an opened text tab retains the raw byte snapshot used to produce its decoded text plus the last loaded/saved decoded baseline. Choosing another encoding reinterprets that same snapshot, so it cannot unexpectedly pull a newer remote version or conflate encoding choice with Refresh. Refresh explicitly rereads the remote file and, when unsaved edits exist, requires discard confirmation before replacing the tab. Save writes the current text using the selected encoding. Reverting edits exactly back to the loaded/saved baseline clears the dirty marker and Save state. UTF-8 / UTF-16LE / UTF-16BE and the broader legacy encoding labels remain stable UI values even when Backend/iconv uses normalized internal aliases; LF / CRLF / CR conversion participates in the same dirty-baseline comparison.

**Old-design review:** frontend `Buffer`/iconv decoding inside a global Pinia store is not an owner requirement. The clean Backend `RemoteTextFileService` already reads one byte snapshot, detects/decodes it and returns `rawContentBase64`; the regression was at the clean Workspace Interface, which dropped those raw bytes. The clean File Editor model owns the raw snapshot, canonical editor-facing encoding label, decoded baseline and reinterpretation helper; Workspace remains a transport mapper and Refresh continues to use `FileDocumentPort.load`. Final-old encoding changes could silently discard dirty edits; the clean UI intentionally retains its discard confirmation before reinterpretation as a data-loss guard while preserving the Git-required distinction between reinterpret and Refresh.

**Refactored design/implementation:** Backend `filesystem.readText` now exposes the existing `rawContentBase64` through the typed Workspace response, `RemoteTextFile` and `LoadedEditorDocument`. `EditorDocument` retains raw bytes plus `originalContent`; a feature-owned `editorEncoding` helper canonicalizes UI labels and decodes the stored snapshot locally, including UTF-16 aliases and the legacy iconv encodings. `changeEncoding()` no longer reads the network; successful save recomputes the raw snapshot for the saved encoding, while explicit reload replaces raw/content/baseline/encoding from Backend. Normal edits and line-ending conversion derive `dirty` from `content !== originalContent`, so undoing back to the baseline correctly clears modified state.

**Status:** PASS.

### GREQ-EDIT-002 — Editor tabs have shared-or-session runtime ownership, preserve per-tab view state, and popup hide/close have distinct cache semantics

**Git/final-baseline evidence:** `88ad7332` added tab close/close-others/close-left/close-right actions; `9f6d8258` restored each tab's scroll position when switching; `8dfa8226` made shared tabs identify their source session; `10ed9ab6` introduced close-cache control; `c2c4c81c` unified that behavior with popup-editor mode, and final-old `12f9f80c` removed the separate clear-cache setting from the overlay and used `showPopupFileEditorBoolean` for explicit-close cache clearing. The final old behavior was: clicking the overlay backdrop only hides the editor and preserves open tabs; the explicit close button, when popup editing is enabled, clears all tabs for the relevant editor owner before hiding. In shared mode that means the shared tab set; in non-shared mode it means that Workspace/session tab set.

**Required behavior:** `shareFileEditorTabs=true` uses one shared editor session across Workspace sessions with file identity still scoped by source session and a human-readable source-session label; `false` uses the owning Workspace session's editor state. Changing this preference while Workspace surfaces are already mounted must switch the active editor owner rather than requiring a remount. Tab activation, Alt+Left/Right cycling, close/others/left/right, dirty marker, encoding and scroll state survive presentation remounts according to that owner lifetime. Closing a Workspace removes its session-scoped documents from the shared owner. In popup mode, backdrop dismissal is hide-only and preserves the editor cache; an explicit editor close action clears the relevant editor tab cache before hiding. Mobile full-screen popup must have a reachable explicit close action.

**Old-design review:** the final old global `fileEditor.store` plus duplicate Session editor actions were an implementation artifact. `workspaceRuntimeRegistry.sharedEditorSession` and `WorkspaceRuntimeSession.editorController` are the correct clean owners. Workspace supplies scope identity/label but File Editor owns tab state. Popup visibility belongs to Workspace presentation, while cache mutation belongs to the File Editor controller. The historical `clearFileEditorTabsOnClose` key is correctly removed; its final semantics are represented by the surviving `showPopupFileEditor` mode rather than a compatibility setting.

**Refactored design/implementation:** Clean shared/per-session ownership, scoped file identity, per-tab scroll state, Alt navigation and context actions remain in the feature/runtime owners. `workspaceRuntimeRegistry.remove()` already closes the removed Workspace scope in the shared controller. `FileEditor` now resolves `props.session` dynamically instead of capturing the initial controller, so a live `shareFileEditorTabs` toggle changes owner without remounting. Workspace passes `scopeLabel` from connection name/host; shared-mode UI exposes that label without File Editor importing Connections. The combined document modal now has separate `hideDocumentPopup()` and explicit `closeDocumentPopup()` paths: backdrop remains hide-only, while the reachable header close clears the active editor/preview owner then hides, including on mobile full-screen.

**Status:** PASS.

### GREQ-EDIT-003 — Desktop Monaco preserves final editor visuals, shortcuts, scrolling and wheel font scaling

**Git/final-baseline evidence:** `0e3380da`, `5f7c7572` and `0f17d514` established configurable/persisted editor font size and custom font family; `2cc5f5a6` smoothed wheel scaling and `73229fa6` finalized the shared wheel resolver; `9f6d8258` preserved scroll positions; `07d307af` fixed popup resize/layout handling; `d5ba109a` kept desktop popup size browser-local and isolated from mobile; `80f4fcf9` modernized Monaco workers; `cfd032a4` moved generic wheel mechanics under Foundation. The final old Monaco used `vs-dark`, line numbers, an enabled minimap, `scrollBeyondLastLine=false`, Ctrl/Cmd+S, and Ctrl-wheel scaling through the shared resolver over the 8–40 range. `e745e176` / `3f8d0322` also evolved demand-loading/prewarming of editor resources.

**Required behavior:** desktop editing uses the final dark Monaco presentation with line numbers and minimap, current appearance font family/size, save shortcut, restored horizontal/vertical scroll, and shared wheel scaling bounded to 8–40 with persistence through the Appearance owner. Resizing/revealing the editor keeps Monaco laid out correctly and desktop popup dimensions remain browser-local rather than being overwritten by mobile full-screen presentation. The normal 400×300 desktop popup minimum may shrink only when the viewport cannot contain it.

**Old-design review:** the historical Monaco-local font-size storage key and manual component-owned ResizeObserver are not ownership requirements; Appearance is the canonical persisted font owner, Monaco `automaticLayout` can own effective editor layout, and Foundation owns generic wheel/resize mechanics. The user-visible Monaco options and effective resize/font interactions remain requirements. Demand-loading/prewarm commits are performance/loading evidence, but per the current refactor policy bundle/code-splitting work remains deferred to final size/performance review rather than driving premature architecture changes now.

**Refactored design/implementation:** Clean Monaco now explicitly restores `vs-dark` and the enabled minimap while retaining line numbers, `scrollBeyondLastLine=false`, Ctrl/Cmd+S, worker setup, automatic layout and per-tab scroll restoration. A Foundation `createWheelScaleResolver` handles Ctrl-wheel 8–40 scaling; `FileEditor → WorkspaceLayoutRenderer → WorkspaceSessionSurface → WorkspaceView` forwards the new size and Appearance persists it through the same latest-value saver pattern used by other presentation settings. Desktop popup size remains browser-local at the final-old 75%×85% default, mobile remains full-screen, and the Foundation resize primitive now uses responsive minimums so narrow viewports stay reachable without changing normal desktop sizing.

**Status:** PASS.

### GREQ-EDIT-004 — Mobile CodeMirror keeps search, language tooling, pinch zoom and no active-line gutter highlight

**Git/final-baseline evidence:** `39808e5a` integrated CodeMirror for mobile; `79b94e47`, `b4442cd4` and related updates added syntax highlighting/language coverage; `d3b21f37` exposed search; mobile pinch scaling was persisted through Appearance; `2804be28` explicitly removed the active line-number gutter highlight while retaining active-line highlighting. Ctrl/Cmd+S and the normal CodeMirror history/folding/bracket/autocomplete/search keymaps remained in the final old editor.

**Required behavior:** mobile uses CodeMirror with the final language-aware syntax support, search panel, save shortcut, history/folding/bracket matching/autocomplete/selection matching, dark theme and 8–40 pinch font scaling persisted through Appearance. The active line may be highlighted, but its line-number gutter must not receive the removed active-gutter highlight. Editor state/scroll must remain stable across tab/presentation changes as far as the clean session model supports it.

**Old-design review:** CodeMirror may lazy-load language packages and receive appearance state through props; it must not import a global settings/session store. The `2804be28` visual fix is observable behavior and should not be regressed merely because the clean component was rewritten.

**Refactored design/implementation:** Clean `CodeMirrorMobileEditor` keeps the final vscode-dark presentation, line numbers, history/folding/bracket matching, close-brackets/autocomplete, selection matching, search panel, Mod-S and broad lazy-loaded language modes. Pinch scaling remains bounded to 8–40 and is persisted through the Appearance owner. The accidental `highlightActiveLineGutter()` regression has been removed while `highlightActiveLine()` remains, matching `2804be28`. Per-tab scroll state continues to live in the File Editor session model rather than component-local/global Session state.

**Status:** PASS.

### GREQ-PREVIEW-001 — Preview provider eligibility, inline-size limits and remote-content safety remain format-owned

**Git/final-baseline evidence:** `7b7c8321` introduced streamed image preview behind a preview-provider boundary; `5a701f2c` added Markdown/XLSX; `f11d649c` added explicit spreadsheet limits; `5a0f8b04` added PDF.js; `6971379b` added DOCX and multi-file preview; `38376177` added code-only provider prewarming; `12f9f80c` finalized the PDF inline limit at 20 MiB. The final providers cap Markdown at 2 MiB, XLSX at 10 MiB, and Image/PDF/DOCX at 20 MiB. The final image provider deliberately excludes SVG because a remote SVG can reference external resources. The final Markdown provider sanitizes rendered HTML with an HTML-only DOMPurify profile and explicitly rejects interactive/resource-loading tags such as `img`, `iframe`, forms/media/style plus `srcset`/inline style.

**Required behavior:** preview eligibility and maximum inline bytes are decided before rendering by File Preview, not by FileManager presentation. Final required formats remain PNG/JPEG/GIF/WebP image, Markdown, PDF, XLSX and DOCX; safe additional formats may remain only if they do not weaken the final security/behavior contract. Remote SVG must not be rendered as an image preview. Markdown must not be able to turn remote document content into arbitrary subresource loads or interactive embedded content. Oversized files produce the normal preview-too-large outcome instead of attempting an unbounded browser parse. Image preview retains loading/failure feedback and contained scaling. Markdown retains sanitized rich-text presentation and the Edit transition.

**Old-design review:** the old global provider registry and hover prewarm map are not owner requirements. The clean `previewRegistry`, `FilePreviewSource` and format components already form the correct File Preview boundary. Current eager imports mean reproducing provider prewarm now would be premature code-splitting/performance work, which remains deferred by refactor policy. Security, eligibility and inline-size semantics are not deferred.

**Refactored design/implementation:** VALIDATED — clean inline limits match the final values; remote SVG is explicitly excluded while safe additional raster formats may remain. Markdown now uses the final HTML-only DOMPurify profile with resource-loading/interactive tags and inline resource/style attributes blocked. Image preview owns contained rendering plus loading/failure feedback. Provider prewarming is intentionally not recreated while the clean build is still eager and size/code-splitting work remains deferred.

**Status:** PASS.

### GREQ-PREVIEW-002 — Preview tabs survive navigation/remounts while pending loads, refresh, hide/close and focus obey final lifetimes

**Git/final-baseline evidence:** `6971379b` introduced multi-file preview tabs; `f45e363c` added explicit per-tab refresh; `45ba5c1f` stopped directory navigation from destroying loaded preview tabs and kept only pending loads cancellable; `38376177` separated backdrop/Escape hide from explicit close-cache behavior; `12f9f80c` finalized focus restoration and tied explicit close-cache semantics to `showPopupFileEditor`; `30c4a6fd` made the active preview tab scroll into view and restored mobile-sized tab/toolbar touch targets. Final FileManager preview state used session+path tab identity, cancelled stale initial loads, kept per-tab refresh cancellation separate, swapped refreshed resources before disposing the previous successful resource, restored the element focused before preview, and deliberately closed the current Markdown preview tab before transitioning to Editor.

**Required behavior:** one Workspace session owns its preview tabs independently of FileManager/pane presentation. Folder navigation and presentation remounts do not destroy already-loaded preview tabs. Reopening an existing path activates its tab, and horizontally overflowed tab strips keep the active tab visible with mobile-appropriate touch targets. A later result from a cancelled/closed/replaced load or refresh must not resurrect or overwrite stale state. Refresh keeps the previous successful preview usable until replacement data succeeds; a failed refresh reports failure without replacing good content with an error-only tab. Backdrop and Escape only hide and preserve tabs. Explicit close follows the popup-editor close-cache setting and clears the relevant preview owner when required. Opening preview remembers focus and hide/final-close restores it when still connected. Preview → Editor closes the active preview tab so returning cannot expose stale preview bytes.

**Old-design review:** AbortController belonged to the old HTTP fetch mechanism, not to FileManager ownership. The clean `FilePreviewSessionController` should own operation generations/refresh state and `FilePreviewSource` may accept an `AbortSignal`; the Workspace WebSocket adapter may stop waiting/ignore a stale result even if the underlying server read cannot be physically cancelled. Workspace owns only popup/focus/cross-feature transitions. Generic Escape/focus modal behavior belongs in Foundation overlay rather than a preview-only dialog copy.

**Refactored design/implementation:** VALIDATED — `FilePreviewSessionController` owns tab/source/operation lifetime with per-tab AbortController tokens and stale-result suppression. Initial open may cancel a still-loading predecessor, while refresh uses a distinct `refreshing` state and preserves the previous successful bytes until replacement succeeds. `FilePreviewSource` accepts an AbortSignal and the Workspace adapter races it against WS requests without leaking protocol details into the feature. Generic Escape/focus-on-open/restore-focus behavior now lives in Foundation `OverlayPanel`/`BaseModal`; Workspace keeps backdrop/Escape hide separate from explicit close-cache behavior, closes the active preview before Preview → Editor, and non-popup hide switches presentation back to Editor while preserving preview tabs. The clean tab strip now scrolls its active tab into view and restores final mobile-sized tab/toolbar/search touch targets without bringing back the old preview dialog owner.

**Status:** PASS.

### GREQ-PREVIEW-003 — Spreadsheet preview preserves bounded XLSX fidelity, pagination, keyboard navigation and cross-sheet search

**Git/final-baseline evidence:** `5a701f2c` added spreadsheet preview; `f11d649c` moved preview parsing behind bounded rows/columns settings; `26d234e8` added row pagination; `df2fe2af` fixed partial final pages; `c3403a2c` separated content/sheet horizontal scrolling; `96e12e40` removed blank placeholder rows; `770bc26f` restricted header styling to the first page; `4c621687` added cross-sheet document search. The final `xlsxPreviewParser` reads dense XLSX data, uses the real `!ref` range, preserves formatted cell text, bounded column widths and row heights, limits displayed columns, pages only actual rows and exposes a capped search index.

**Required behavior:** XLSX preview obeys the persisted 10–2000 rows/page and 5–200 max-column settings, reports total rows/columns and truncation, renders actual rows without invented placeholder grid rows, preserves useful workbook column widths/row heights and formatted cell text, and styles the first source row as a header only on page one. Pagination exposes range/current/page count, supports previous/next plus PageUp/PageDown, and normal arrow keys scroll the grid. Sheet switching resets page/scroll. Search spans sheets, caps work, highlights all matches visible on the current sheet, distinguishes the active match and navigates to the correct sheet/page/cell. A dedicated bottom horizontal scrollbar remains available independently of vertical content scrolling.

**Old-design review:** the parser does not belong in Preferences or Workspace and the old provider's direct settings-store import is not retained. File Preview should own a clean parser/model helper; Workspace only passes Preferences-owned numeric limits. Extra clean support for XLS/CSV may remain if it can satisfy the same bounded behavior, but it must not weaken required XLSX semantics.

**Refactored design/implementation:** VALIDATED — clean Spreadsheet now parses dense workbook data behind `model/spreadsheetPreview.ts`, uses the real worksheet range and formatted cell text, clamps persisted rows/page and max-column settings, preserves explicit workbook column widths/row heights without inventing sizes when metadata is absent, and keeps hidden dimension metadata from forcing display sizes. Presentation restores row numbers, first-page-only header styling, wrapped cell text, pagination/ranges, PageUp/PageDown plus arrow scrolling, sheet switching, 10,000-capped cross-sheet search with all/active match highlighting, truncation feedback and the dedicated bottom horizontal scrollbar.

**Status:** PASS.

### GREQ-PREVIEW-004 — PDF continuous reading waits for measured pages, restores hidden state and preserves exact search/outline/touch navigation

**Git/final-baseline evidence:** `5a0f8b04` introduced PDF.js preview; `457f633c` restored worker setup and bottom horizontal scrolling; `30c4a6fd` finalized mobile touch interaction; `2c555695` replaced single-page/thumb navigation with continuous reading plus outline; `3d5dec04`, `a96f25bd`, `5ca528c1`, `cdb9dbb4`, `fb7eee5f` and `6462fde3` successively fixed unmeasured-page tracking, hide/reveal restoration and page-jump races; `e283ed0f`, `56da22a7`, `e96c6a34`, `9150fe02` finalized desktop persistent/mobile drawer outline behavior; `4c621687` added text-layer search.

**Required behavior:** PDF uses continuous lazily rendered pages with selectable text, worker-backed parsing, 25–400% zoom, fit-width, bottom horizontal scrolling and pinch zoom. Current-page tracking ignores unmeasured/hidden pages. Explicit page/outline/search jumps wait until the target and preceding page metrics are stable before calculating scroll offsets. Hide/reveal preserves current page and scroll, re-anchoring to the saved page when measurements changed or a jump was pending. PageUp/PageDown navigate pages. Search indexes document text with bounded concurrency, counts every occurrence even when the same query appears multiple times inside one text item, highlights all text-layer matches and distinguishes the active occurrence. Desktop outline can remain visibly docked/toggled while mobile uses a dismissible drawer whose state synchronizes across breakpoint changes.

**Old-design review:** current clean `PdfPage` already owns the right IntersectionObserver/render-task/text-layer lifecycle and should not be replaced. The missing logic belongs in clean `PdfPreview` plus the existing `previewDomSearch` helper, which already implements exact repeated-occurrence DOM marking. No PDF state belongs in Workspace or a global store.

**Refactored design/implementation:** VALIDATED — clean `PdfPage` keeps IntersectionObserver-driven lazy rendering/release and now reuses the shared exact occurrence-splitting DOM search helper. `PdfPreview` owns the final continuous-reading state machine: measured-page tracking, pending jumps that wait for preceding metrics, hidden/short-page filtering, hide/reveal scroll + current-page anchoring, width-change re-anchoring, PageUp/PageDown, bounded four-worker search indexing with every repeated occurrence counted, smooth search navigation, desktop persistent/mobile drawer outline, 25–400% zoom/fit-width, pinch zoom and the shared bottom horizontal scrollbar.

**Status:** PASS.

### GREQ-PREVIEW-005 — DOCX preview keeps final page-break/resource fidelity, search, refresh and horizontal navigation

**Git/final-baseline evidence:** `6971379b` added DOCX preview; `38376177` made its heavy component preloadable; `4c621687` added document search. The final DOCX renderer uses `docx-preview` with page breaking, width/height/fonts preserved, `ignoreLastRenderedPageBreak=false` and `useBase64URL=true`; it exposes rendering/error feedback, re-renders refreshed bytes, highlights/navigates all search matches and provides the shared bottom horizontal scrollbar. Installed `docx-preview` defaults confirm that `ignoreLastRenderedPageBreak` defaults to true and `useBase64URL` defaults to false, so those final settings are intentional rather than redundant.

**Required behavior:** DOCX renders page dimensions/fonts and both explicit and last-rendered page breaks closely enough to the final viewer, keeps embedded document resources self-contained for the preview lifetime, shows loading/failure feedback, supports Ctrl/Cmd+F search with all/active match highlighting, survives hide/show without unnecessary state loss, reacts to refreshed bytes and exposes horizontal scrolling for wide pages.

**Old-design review:** DOCX rendering/search remains entirely inside File Preview. Lazy prewarm remains performance-only and is deferred with code splitting; the required render options and lifecycle are functional fidelity and must be restored now.

**Refactored design/implementation:** VALIDATED — clean DOCX keeps render/search state inside File Preview, rerenders refreshed bytes, preserves hide/show without redundant rerender, and uses the final non-default render options including `ignoreLastRenderedPageBreak=false`, preserved width/height/fonts and `useBase64URL=true`. It now exposes loading feedback, localized failure presentation, exact all/active match search via the shared DOM helper and the dedicated bottom horizontal scrollbar.

**Status:** PASS.

### GREQ-STATUS-001 — Status sampling/history is Workspace-session owned with multi-consumer lifecycle and reconnect-safe resubscription

**Git/final-baseline evidence:** `2e69a000` moved Status data/history out of the presentation into a per-session manager; `1c892055` replaced layout-coupled subscription checks with explicit consumer `activate()` / `deactivate()` semantics and interval refresh; the final `createStatusMonitorManager` retains up to 1800 samples, owns a monotonic history sequence, ref-counts consumers, unsubscribes only when the last consumer detaches, and re-subscribes after connection/real SSH readiness. Session close explicitly cleans the manager. The final desktop pane and mobile status modal may both consume the same session manager.

**Required behavior:** Status current/error/history state lives for the Workspace runtime-session lifetime rather than a specific StatusMonitor component mount. Desktop pane, sidebar/layout remounts and mobile modal attach as independent consumers to one session-owned status controller. The first consumer starts Backend sampling; additional consumers share the same history; removing one consumer cannot stop sampling while another remains. Removing the last consumer stops Backend sampling but keeps accumulated history for later remount. A transport disconnect does not clear local history; after a real Workspace reconnect/resume succeeds, active consumers resume sampling. Changing the persisted status interval while consumers are active must restart the Backend sampler so it re-reads the current Settings value. Session dispose tears down subscriptions and polling.

**Old-design review:** the old Pinia Session mega-store is not required. What must survive is the manager lifetime and consumer/ref-count semantics. In the clean architecture this belongs to a Status-owned `StatusMonitorSessionController` retained by `WorkspaceRuntimeSession`; Workspace only notifies capability availability across connect/disconnect/resume and passes the controller to presentations. Raw Workspace event names remain in the runtime adapter. `StatusChannel.start(intervalSeconds)` is misleading because Backend owns the interval through Settings; the clean port should express `start()` / `stop()` and the Status controller should implement interval refresh as stop+start.

**Refactored design/implementation:** VALIDATED — `createStatusMonitorSession()` now owns current/error/history, aligned 1800-point sequence history and ref-counted presentation consumers for the Workspace-session lifetime. `WorkspaceRuntimeSession` retains the Status-owned controller and forwards real connect/resume/disconnect/dispose availability without interpreting Status state. Desktop pane and mobile modal share the same controller; the first consumer starts Backend sampling, the last stops it without clearing history, active consumers resume after reconnect, and interval changes restart the sampler so Backend re-reads Settings. `StatusChannel` now correctly exposes parameterless `start()`/`stop()`. Sampling transport failures stay Status-local instead of failing the Workspace connection.

**Status:** PASS.

### GREQ-STATUS-002 — Status metric units/details and connection identity match the Backend contract and final visible summary

**Git/final-baseline evidence:** the final Status monitor exposes CPU %, CPU model/OS, memory and swap percentages plus used/total values, disk percentage plus used/total values, active network interface and adaptive B/s/KB/s/MB/s/GB/s throughput. Optional session IP is shown as a keyboard/click-copy target. Final formatters interpret memory/swap values as MB and disk values from `df -k` as KB. The clean Backend `PosixServerStatusCollector` preserves exactly those units: memory/swap MB, disk KB and network bytes/second.

**Required behavior:** Status presentation must not guess incompatible units. Memory/swap MB values are formatted as MB/GB as appropriate; disk KB values are formatted as GB consistently with final-old behavior; network rates adapt units rather than always rendering a raw integer `B/s`. CPU %, memory %, swap %, disk %, CPU model, OS, network interface and optional/copyable host/IP remain reachable. Missing values render the normal unavailable state rather than misleading zero/incorrect conversions. Unit semantics are documented in the clean Status model/helper boundary so future components do not repeat magic divisors.

**Old-design review:** these are Status model/presentation semantics, not Workspace transport behavior. The Backend DTO may retain its established numeric fields, but the frontend Status model should explicitly document the wire-to-domain units and centralize formatting helpers. Connection host/IP continues to be supplied by Workspace composition; clipboard behavior uses the Foundation browser helper.

**Refactored design/implementation:** VALIDATED — The Status model now documents Backend units explicitly: memory/swap MiB, disk KiB and network bytes/second. Feature-owned formatting helpers centralize percent, memory/swap, disk and adaptive throughput formatting. The presentation restores memory/swap/disk used-total details, CPU model/OS, network interface, adaptive download/upload rates and optional copyable host/IP without leaking transport concerns into the component.

**Status:** PASS.

### GREQ-STATUS-003 — Status history uses stable sequence buckets, peak-preserving network scaling and readable interactive charts

**Git/final-baseline evidence:** `50c777cd` prevented history tooltips from clipping by separating tooltip positioning from the chart overflow; `60a364ab` changed network downsampling to bucket maxima and introduced a nice, hysteresis-stabilized network axis so short peaks remain visible without scale jitter; `2f2d9e0b` anchored downsampling buckets to the monotonic global sample sequence so completed history buckets no longer change as the sliding window advances; `1e35c939` fixed chart scaling and light-theme contrast. Final ranges are 1/5/10/30 minutes with percentage histories for CPU/memory/swap/disk and paired network download/upload histories.

**Required behavior:** completed downsample buckets stay stable as new samples arrive; percentage histories average per fixed sequence bucket, network histories use the bucket maximum to retain spikes, and network axis growth/shrink uses the final nice-number/hysteresis behavior. History windowing follows the requested sampling range deterministically by sample count/sequence rather than re-grouping on every offset. CPU/memory/swap/disk use a 0–100 axis; network uses adaptive throughput units. 1/5/10/30 minute selection, download/upload distinction and hover tooltip values/time remain readable without pane clipping and with light/dark theme contrast.

**Old-design review:** the old custom SVG renderer is not an owner requirement. The clean `StatusCharts` Chart.js component already implements fixed sequence buckets, network max buckets and hysteresis, so it may supersede the old SVG as long as units/windowing/tooltips/theme preserve the observable behavior. Chart math stays in Status Monitor; no history computation belongs in Workspace.

**Refactored design/implementation:** VALIDATED — `StatusCharts` keeps Chart.js as the clean renderer but now windows by the monotonic sample sequence/count rather than wall-clock cutoff, anchors completed buckets to fixed sequence ranges, averages percentage buckets, takes network bucket maxima and preserves the final nice-number/hysteresis network axis. Network ticks/tooltips use adaptive throughput formatting; percentage tooltips remain percent-aware. Chart text/grid/dataset/tooltip colors resolve from live UI theme variables and refresh when Appearance rewrites root theme styles.

**Status:** PASS.

### GREQ-STATUS-004 — Status presentation responds to pane size, supports mobile modal reachability and preserves shared wheel scaling

**Git/final-baseline evidence:** `2616dd1c` and `1c892055` repeatedly fixed status responsiveness for split panes and narrow/short layouts; final Status CSS uses `container-type:size` / `status-pane` container queries and collapses into resource/network summaries when full cards cannot fit. `e5519698` introduced the dedicated mobile Status modal and touch polish with an explicit close control. `48dd969f` stabilized persisted 0.65–1.6 Ctrl-wheel panel scaling; `73229fa6` moved Status to the shared `createWheelScaleResolver`. `1e35c939` aligned the scaled chart/presentation with theme variables.

**Required behavior:** Status layout responds to the actual pane/container width and height, not browser viewport breakpoints, so a narrow split pane remains usable on a wide desktop. Cards/history can compact or summarize rather than overflow/collapse. Mobile exposes Status from the workspace tools in a bounded modal with backdrop and explicit close, touch-sized controls and no sticky hover dependency. Ctrl+wheel uses the shared resolver with 0.65–1.6 bounds and persisted Preferences-owned scale; normal wheel scrolling remains unaffected.

**Old-design review:** layout composition/mobile modal visibility belongs in Workspace; the actual responsive Status surface belongs in the Status feature and should use container queries. Scale persistence already correctly flows through Workspace/Preferences and must not be moved back into a Status/global settings store. The same session-owned Status controller should feed both desktop and mobile presentations.

**Refactored design/implementation:** VALIDATED — Status now declares a size container and uses pane-local container queries rather than viewport breakpoints: columns compact by actual pane width, history range controls degrade in low height, and panes at the final-old extreme-height threshold switch to a resource/network summary instead of collapsing the full card layout. Mobile Status remains Workspace-composed through Foundation `BaseModal`, now has an explicit touch-sized close action and shares the session controller with desktop. Ctrl+wheel continues through the shared 0.65–1.6 resolver, while Preferences persistence remains the existing latest-value saver with flush-on-dispose semantics.

**Status:** PASS.

### GREQ-DOCKER-001 — Docker polling/state is Workspace-session owned, demand-driven and honors the persisted refresh interval

**Git/final-baseline evidence:** `638e66ee` introduced the visible `dockerStatusIntervalSeconds` / `dockerDefaultExpand` settings and used the Docker interval for Backend polling; `21e71857` retained Settings-driven polling during the WebSocket refactor. `37eae0a8` then limited Docker listeners/timers to when the pane was actually in use. `f7fe1904` extracted a per-session Docker manager. Finally `e745e176` replaced layout-store checks with explicit consumer `activate()` / `deactivate()` semantics: detaching the last presentation stopped polling without clearing the current containers/expanded state, reconnect restarted active polling, and real disconnect/cleanup cleared runtime data. That demand-driven refactor removed the Backend polling loop but left a hard-coded 15-second frontend safety timer, unintentionally making the still-visible Docker interval setting ineffective.

**Required behavior:** Docker live state belongs to the Workspace-session lifetime rather than one `DockerManager.vue` mount. All presentations for a session attach to one Docker session controller. The first consumer performs an immediate status request and starts polling; additional consumers share the same state; removing the last consumer stops polling but keeps the latest container snapshot and expansion choices for remount. Real Workspace disconnect invalidates in-flight results and clears container/availability/expanded/first-load state; active consumers resume immediately after a real reconnect/resume. The persisted `dockerStatusIntervalSeconds` setting is the actual demand-driven polling interval, restoring the historical setting requirement instead of copying the late hard-coded-15s regression or deleting the visible setting. Polling remains capable of detecting Docker becoming available after being installed/started while the pane remains mounted.

**Old-design review:** do not restore the Pinia Session mega-store, layout-store checks or raw WebSocket listeners. The clean owner is a Docker feature session controller retained by `WorkspaceRuntimeSession`; Workspace only forwards capability availability and presentation lifecycle. `DockerChannel` remains transport-neutral. Preferences owns interval/default-expand values and passes them into the presentation/controller. Timer overlap/stale responses must be bounded inside the Docker controller.

**Refactored design/implementation:** VALIDATED — `createDockerSession()` now owns availability, container snapshot, fetch error, expansion IDs, first-load default expansion, consumer count, polling timer and stale-request generation for the Workspace-session lifetime. `WorkspaceRuntimeSession` retains the Docker-owned controller and forwards real connect/disconnect/resume/dispose availability. The first presentation consumer refreshes immediately and starts the Preferences-owned interval; the last detach stops polling but preserves snapshot/expansion; real disconnect clears runtime state and invalidates in-flight requests. Timer ticks reuse an in-flight request, while post-command force refresh waits for any existing request and performs one fresh status read.

**Status:** PASS.

### GREQ-DOCKER-002 — Clean Docker WebSocket DTOs, container stats and default-expand semantics match the final manager

**Git/final-baseline evidence:** the April Docker UI/status work and `f7fe1904` final manager extraction converge on one status payload containing all containers plus running-container stats. Final expansion shows CPU, memory usage/limit + percentage, network I/O, block I/O and PIDs. Expansion IDs are session-manager state: vanished container IDs are removed, `dockerDefaultExpand` is applied only on the first successful load of that connection lifecycle, manual expansion survives presentation detach, and real disconnect resets the first-load/expanded state. The final narrow-card and desktop views consume the same manager snapshot.

**Required behavior:** the clean Workspace WebSocket Interface exposes camelCase Docker DTOs matching the frontend model: container `names/image/imageId/command/created/state/status/ports/labels/stats`, port `ip/privatePort/publicPort/type`, and stats `id/name/cpuPercent/memoryUsage/memoryPercent/networkIo/blockIo/pids`. Platform/RemoteDockerService may keep Docker-CLI-shaped fields internally; the Interface maps them at the boundary. Status refresh preserves only expansion IDs that still exist. Default-expand applies once per connection/load lifecycle and does not re-expand manually collapsed rows merely because the component remounted. Expanded details expose all five final stats dimensions, using the stats already bundled by Backend status rather than creating a second stats polling owner.

**Old-design review:** DTO casing is an Interface responsibility, not a frontend compatibility mapper. Docker feature state owns expansion/default-first-load semantics. The existing `docker.stats` capability may remain available, but normal list rendering should consume the bulk status snapshot already produced efficiently by Backend; no per-row stats timer is required.

**Refactored design/implementation:** VALIDATED — The clean Workspace WebSocket Interface now maps Platform Docker CLI-shaped status/stats objects to the frontend camelCase DTO at the Backend Interface boundary; the frontend adapter no longer relies on an unsafe generic assertion over uppercase payloads. Expansion/default-first-load semantics live in the Docker session controller, stale IDs are pruned on successful status refresh, and the presentation restores CPU, memory, network I/O, Block I/O and PIDs from the bulk status snapshot. The separate `docker.stats` capability remains available and is mapped through the same clean DTO boundary without creating a second polling owner.

**Status:** PASS.

### GREQ-DOCKER-003 — Container lifecycle actions and Enter/Logs preserve final execution semantics without a duplicate Docker shell protocol

**Git/final-baseline evidence:** final Docker actions support start, stop, restart and remove; `a81fb6fd` made remove available for running containers and added Enter Container plus Logs. The final Backend semantics use forced remove for running containers. Enter emits `docker exec -it <id> sh` for terminal execution and Logs emits `docker logs --tail 1000 -f <id>`; both are terminal commands, not Docker-manager RPCs. `27cb02b8` removed intrusive alert-based command error handling.

**Required behavior:** start/stop/restart/remove call only the Docker capability, refresh once after successful mutation and surface failure through current shared feedback rather than legacy alerts. Remove remains reachable for running containers and Backend uses its existing safe `rm -f` implementation. Enter/Logs remain reachable from each container row as in final-old (including Logs for stopped containers) and emit a terminal-command intent; Workspace owns actual terminal execution/history semantics. The Docker feature must not know raw Workspace event names or open a second execution protocol. Container identifiers continue to be validated by Backend before shell interpolation.

**Old-design review:** the old workspace event bus is superseded by the existing clean `terminalCommand -> Workspace command intent -> TerminalChannel.sendInput` composition. `WorkspaceView.sendCommand()` already normalizes any trailing newline and appends `\r`, so the clean Docker intent need not embed terminal key semantics itself. Destructive confirmation may remain as a safer current presentation behavior, but its user-visible copy should be localized.

**Refactored design/implementation:** VALIDATED — Start/stop/restart/remove now execute through the session controller and trigger exactly one post-command force refresh. Start/stop/restart remain state-disabled, remove remains reachable for running containers and keeps the current shared destructive confirmation with localized copy. Enter and Logs remain row-level terminal-command intents for every container (so stopped-container logs remain reachable); `WorkspaceView.sendCommand()` owns CR execution/history and no Docker shell/event-bus protocol was introduced.

**Status:** PASS.

### GREQ-DOCKER-004 — Docker remains usable in narrow split panes through pane-local table/card responsiveness and explicit connection states

**Git/final-baseline evidence:** `eaa16ad3` and `714f173a` stabilized Docker responsive presentation around a named CSS container; at `docker-manager-pane <= 600px` the desktop table header/row layout becomes cards, labels remain visible, actions remain reachable, expansion moves into the card and the desktop expansion row hides. The final component also distinguishes Workspace/SSH connecting, disconnected, error, Docker loading, Docker unavailable, fetch error and empty-container states instead of presenting all failures as one generic table state.

**Required behavior:** Docker responsiveness follows the actual pane width, not browser viewport breakpoints. Wide panes render a compact table with status/ports/actions and a separate expansion row; <=600px pane width renders self-contained cards with field labels, reachable actions and in-card expand/collapse/stats. State badges keep running/exited/paused/restarting distinguishable. Workspace lifecycle presentation distinguishes connecting/reconnecting, disconnected/error, status loading, Docker unavailable, fetch failure and empty list. Touch/narrow controls remain reachable without deleting actions.

**Old-design review:** responsive layout and container state presentation belong in Docker UI. Workspace may pass its lifecycle state/status message as presentation inputs, but Docker does not import runtime internals or store Workspace state. No global media-query/layout store should be recreated.

**Refactored design/implementation:** VALIDATED — `DockerManager` is now a named inline-size container: wide panes render the table/detail-row presentation, <=600px panes convert rows into labeled cards with wrapped reachable actions and an attached detail card, and <=320px panes further collapse label/stats grids. Workspace passes only lifecycle state/status text as presentation inputs, restoring connecting/reconnecting, disconnected, connection-error, Docker loading/unavailable/fetch-error and empty states without importing runtime internals into the Docker feature. Coarse-pointer action/expand controls keep at least 44px targets.

**Status:** PASS.

### GREQ-RDP-001 — RDP/VNC session creation, RemoteApp propagation and failure cleanup stay inside the Remote Desktop owner

**Git/final-baseline evidence:** final-old uses `RemoteDesktopModal.vue` for RDP and `VncModal.vue` for VNC. Both create a short-lived Guacamole session only while the modal is open, reconnect by replacing the previous client/display, and disconnect/clear input/display resources on close/unmount or connection replacement. `da3fef29` added the final RDP RemoteApp path and display-update session behavior; the current Backend lineage carries RemoteApp alias/directory/arguments through Connections -> `RemoteDesktopSessionService` -> Guacamole adapter -> remote-gateway. Tunnel/client errors are terminal for the current Guacamole client and final-old immediately disconnects that failed client while preserving an error state/retry path.

**Required behavior:** opening an RDP/VNC connection requests a session only through the Remote Desktop capability, creates one Guacamole client/tunnel for the current visible connection, and destroys it on close, connection replacement, reconnect or failure. A late token/session response from a closed or superseded attempt must not resurrect a hidden/stale client. Tunnel/client errors remain visible as Remote Desktop errors and release the failed Guacamole client/input resources. RDP RemoteApp values already owned by Connections continue to reach the gateway without frontend Remote Desktop duplicating those fields. Reconnect remains reachable while an error/disconnected session is visible and does not allow overlapping connection attempts. The feature does not retain Guacamole state in `WorkspaceRuntimeSession` and does not restore the old global Session/event-bus owner.

**Old-design review:** modal lifetime is the correct product lifetime for a Guacamole client; unlike Status/Docker, remote desktop state is intentionally discarded when the modal closes. The clean `RemoteDesktopSessionPort` is the single frontend session-creation owner. Duplicate unused RDP/VNC session methods in Connections API are not separate product capabilities and should not remain a parallel owner. HTTP/gateway details stay behind the Remote Desktop port and Backend Module/Infrastructure boundaries.

**Refactored design/implementation:** VALIDATED — Remote Desktop remains modal/feature-lifetime rather than Workspace-session state. The modal now owns a connect generation so hidden/replaced connection attempts cannot attach a late token/client, rejects overlapping reconnect while connecting, and tears down failed Guacamole clients while preserving the visible error/retry state. RemoteApp continues through the existing clean Backend/gateway chain. The unused parallel `connectionsApi.createRdpSession/createVncSession` methods were removed so `RemoteDesktopSessionPort` is the sole frontend session-creation owner.

**Status:** PASS.

### GREQ-RDP-002 — Desktop pointer, focus and clipboard behavior preserves the final Guacamole interaction contract

**Git/final-baseline evidence:** `6ecbbb3c` restored VNC keyboard input; `6f4996fc` added host-to-VNC clipboard sync on display focus; `5a04a138` added RDP host-to-remote clipboard sync and display-focus behavior. Final RDP also accepts remote `text/plain` clipboard streams and writes them to the host clipboard. Both final modal implementations make the Guacamole display focusable, forward mouse down/move/up with display scaling semantics, hide the local pointer while it is over the remote display, render the Guacamole cursor above canvases, release keyboard/mouse/clipboard handlers during disconnect, and return focus to the display after local width/height or VNC text inputs blur.

**Required behavior:** desktop mouse and keyboard events target the current Guacamole display only. The local browser cursor is hidden while over the remote desktop and restored on leave/cleanup while the Guacamole cursor remains visible above display canvases. Clicking the display returns keyboard focus after local controls used it. Host clipboard text is offered to the remote side on display focus without making clipboard permission denial fatal; remote plain-text clipboard streams are written back to the host where supported. Reconnect/cleanup removes feature-installed click/focus/cursor/clipboard forwarding from the old display. VNC keeps its explicit text-send control and temporarily suppresses direct remote keyboard forwarding while that local text field is focused.

**Old-design review:** clipboard and Guacamole pointer/focus mechanics are Remote Desktop feature behavior; browser clipboard access should use the Foundation browser helper where applicable. Raw Guacamole callback details must not leak into Workspace. The clean shared RDP/VNC bridge may safely provide bidirectional text clipboard to VNC as an additional capability as long as final host-to-VNC behavior remains intact.

**Refactored design/implementation:** VALIDATED — The unified clean RDP/VNC surface keeps the feature-owned plain-text clipboard bridge, scaled Guacamole mouse forwarding and local-control keyboard suppression. It now hides the browser cursor while the remote display is hovered, restores it on leave/cleanup, raises the Guacamole cursor layer above display canvases, restores display focus after local VNC input, and removes feature-installed mouse/focus/clipboard handlers when the client is replaced or destroyed.

**Status:** PASS.

### GREQ-RDP-003 — RDP mobile direct/touchpad input and hidden-keyboard IME handling match the final late fixes

**Git/final-baseline evidence:** `c66c5ac7` added switchable direct-touchscreen and touchpad modes backed by Guacamole touch devices and persisted the mode locally; `da534e8c` made a qualifying single-finger tap synchronously focus a hidden textarea so mobile browsers open the system keyboard; `7480456c` hardened composition handling so the textarea is not cleared while IME composition is active. Final touch forwarding scales Guacamole mouse coordinates correctly and destroys the active touch device/listeners when mode/client changes. The touch-mode control and hint remain reachable in the RDP window footer.

**Required behavior:** on touch-capable devices RDP exposes persisted direct and touchpad modes. Switching mode replaces the active Guacamole touch translator without accumulating listeners. A short single-finger tap that has not moved beyond the final threshold opens the hidden system-keyboard textarea from the touch event path; the textarea feeds `Guacamole.Keyboard`, supports composition/IME, and clears only after non-composing input/composition completion. Mobile keyboard focus may also trigger host-to-remote clipboard sync. Closing/reconnecting destroys touch/keyboard listeners. Desktop input behavior is unchanged. Clean may also expose the same touch modes to VNC, but it must not weaken the final RDP behavior.

**Old-design review:** touch translation is protocol-presentation behavior and belongs inside Remote Desktop, not Workspace or a global device store. Persisted touch mode is browser-local UI state, not a server Settings value. The existing clean feature helper is the correct owner; no new global controller is needed.

**Refactored design/implementation:** VALIDATED — Direct/touchpad translation remains feature-owned with the final 300 ms / 12 px tap recognition and scaled Guacamole coordinates, and the browser-local key is restored to `nexus.rdp.touch-mode`. The hidden mobile textarea now tracks `compositionstart`/`compositionend`, ignores composing input clears, clears only after composition/non-composing input completes, and is focused/selected synchronously from the qualifying touch tap while also triggering the existing clipboard sync.

**Status:** PASS.

### GREQ-RDP-004 — Remote window geometry, resize/minimize/fullscreen and persisted protocol-specific sizes preserve final behavior

**Git/final-baseline evidence:** `5091776b` added draggable minimize/restore windows for RDP and VNC; `54c337d8` added pointer resize; `d23a06c3` finalized viewport-clamped persisted sizing with protocol-specific minimums (RDP 1024x768, VNC 800x600) and separate `rdpModalWidth/Height` / `vncModalWidth/Height` settings. `da3fef29` added RDP browser fullscreen plus `ResizeObserver` display-size updates and coalesced Guacamole `sendSize()` calls through `requestAnimationFrame`, explicitly ignoring the temporary 0x0 minimized panel. `f910256a` finalized fullscreen chrome/layering and made Escape exit browser fullscreen without closing the RDP window. Closing RDP while fullscreen exits fullscreen first. Width/height saves use latest-value/debounced persistence and flush at owner teardown.

**Required behavior:** RDP and VNC keep independent persisted sizes. On normal desktop-sized viewports, RDP cannot be resized below 1024x768 and VNC below 800x600; on smaller viewports the panel clamps to the available viewport instead of overflowing. Drag resize and numeric size edits update the local panel and persist the protocol-specific size through the existing Preferences owner. Minimize hides the panel without resizing the remote desktop to zero and exposes a draggable restore control; restore re-synchronizes remote size. RDP browser fullscreen hides local window chrome/resize controls, fills the viewport, updates remote display size, Escape exits fullscreen only, and close exits fullscreen before destroying the session. ResizeObserver/drag/fullscreen bursts are RAF-coalesced before `client.sendSize()`.

**Old-design review:** Preferences owns persisted dimensions; Remote Desktop owns panel geometry/Guacamole display sizing; Workspace only chooses the RDP/VNC preference pair and schedules persistence. The generic overlay/backdrop should come from Foundation, but the Remote Desktop window has custom chrome and therefore should use raw `OverlayPanel` composition rather than stacking `BaseModal`'s standard header/body chrome around another window header. The clean unified modal may retain VNC fullscreen as an extra capability, but RDP final behavior is mandatory.

**Refactored design/implementation:** VALIDATED — Remote Desktop now uses raw Foundation `OverlayPanel` composition around its own window chrome instead of stacking the `BaseModal` preset. Normal RDP/VNC windows retain their final 1024x768 / 800x600 nominal minima when the viewport permits and clamp down to the real available viewport (Backend minimum 200) on smaller screens. ResizeObserver/drag/fullscreen updates are RAF-coalesced, minimize suppresses zero-size sends and restore re-syncs size. Fullscreen fills the viewport and hides local chrome, Escape exits fullscreen only, and close/visibility teardown exits fullscreen before the Guacamole session is discarded. Protocol-specific size persistence remains owned by Workspace/Preferences latest-value saving.

**Status:** PASS.

### GREQ-SSH-001 — Suspended-session catalog preserves final search/poll/rename/log/remove/auto-termination and narrow-pane behavior

**Git/final-baseline evidence:** the final `SuspendedSshSessionsView.vue` presents one user-wide list composed from live `marked_active` sessions plus Backend `hanging` / `disconnected_by_backend` records. It searches custom and connection names, polls only while a consumer is mounted, starts at 3 seconds, doubles on HTTP 429 up to 60 seconds, uses at least 10 seconds after other failures and resets to 3 seconds after success. `05747a46` moved name editing to HTTP and uses the Backend-returned `customName` as the authoritative value. `f3b190bd` added log export for hanging/disconnected sessions without closing the manager. Final remove semantics are status-specific: marked-active unmarks the live Workspace, hanging terminates/removes the suspended transport, disconnected removes only the catalog entry. Backend auto-termination changes a hanging record to `disconnected_by_backend`, retains its log/catalog record and emits a warning. Final presentation uses a named inline-size container; at narrow widths action text collapses while actions remain reachable.

**Required behavior:** the SSH Suspend feature owns one user-wide Backend catalog independent of any single Workspace tab. Search covers custom and connection names. Polling is ref-counted by mounted catalog presentations and preserves the final adaptive 3s/429-backoff/other-error behavior. Rename does nothing for blank/unchanged input, waits for HTTP success and applies the Backend-returned name rather than assuming the submitted string is authoritative. Hanging/disconnected records can export logs; export success/error is surfaced through shared feedback and does not close the manager. Successful terminate/remove updates the catalog and the modal presentation may close, while embedded manager panes remain mounted. Auto-termination retains the record, changes it to disconnected with timestamp and keeps Log Export / Remove Entry reachable. Narrow pane/container presentation hides action labels before hiding actions and remains touch reachable.

**Old-design review:** do not restore suspended catalog state inside the old Session mega-store. The clean module-level SSH Suspend catalog is a valid authenticated-user feature owner because the Backend list is user-wide and multiple modal/pane consumers intentionally share it. Live marked Workspace rows remain composition input from Workspace runtime rather than being copied into the Backend catalog. HTTP cleanup/snake-case removal is deferred to the final HTTP-contract phase, but observable rename/log/remove semantics are not deferred.

**Refactored design/implementation:** VALIDATED — The Backend catalog remains user-wide while each manager presentation now owns its own search term. Polling is ref-counted and preserves the final 3s / 429 exponential / 10s other-error cadence; a forced refresh queued behind an in-flight list request always performs a fresh follow-up read so auto-termination cannot leave a stale loaded snapshot. Rename ignores blank/unchanged edits and applies the Backend-returned trimmed `customName`; log export restores the final body-attached download-link lifecycle plus shared success/error feedback. Hanging/disconnected remove semantics update the catalog, modal removal closes only that modal while embedded panes remain mounted, and auto-termination converts/refreshes the retained Backend record to disconnected instead of deleting it. The manager uses its own inline-size container and keeps icon actions reachable while labels collapse at the final narrow thresholds.

**Status:** PASS.

### GREQ-SSH-002 — Live mark/unmark and marked-active resume stay Workspace-session owned and preserve retained terminal snapshots

**Git/final-baseline evidence:** final mark flow makes a live SSH tab immediately visible as `marked_active`, sends an initial bounded terminal snapshot to the Backend suspend log transaction and suppresses ordinary reconnect once marked. Final marked-active Resume means “return to this still-live terminal” and does **not** implicitly unmark; only the explicit Unmark action clears the pending suspend protection. If the marked socket disconnects, the tab remains marked while Backend asynchronously takes over the SSH transport. The final catalog merges these live marked rows with Backend suspended records rather than asking Backend to invent a `marked_active` transport state.

**Required behavior:** one `WorkspaceRuntimeSession` owns its mark flag/time and calls only the clean `SshSuspendChannel.mark/unmark`. Mark includes the freshest available terminal snapshot: current live serialization when Terminal is mounted, otherwise the retained `TerminalSessionState.snapshot` from the same Terminal feature owner. Successful mark suppresses ordinary reconnect; failed mark does not leave a false local mark. Unmark is explicit and clears the local mark only after Backend success. All catalog presentations receive the current live marked-session composition. Resume on a connected marked row activates that existing Workspace tab without unmarking it. Remove on a marked row means explicit unmark, not Backend terminate/remove of a nonexistent suspended record.

**Old-design review:** Backend request/response now makes the old optimistic mark + ACK rollback event machinery unnecessary. `WorkspaceRuntimeSession` is the right owner for one tab's mark state; Terminal snapshot internals stay in the Terminal feature state instance already retained by the runtime. The SSH Suspend catalog only receives a narrow `MarkedSuspendedSession[]` presentation input and never imports the runtime registry.

**Refactored design/implementation:** VALIDATED — `WorkspaceRuntimeSession` remains the sole owner of one tab's mark/time and clean `SshSuspendChannel.mark/unmark`; local state changes only after the request succeeds and a mark continues to suppress normal reconnect. `WorkspaceView` now sends the live Terminal serialization when mounted and falls back to the retained `TerminalSessionState.snapshot` when that pane is absent. Live marked rows are composed through the empty-state manager, modal, layout tree, sidebars and mobile pane without importing runtime state into the SSH Suspend feature. Resume on a connected marked row only activates that existing tab and leaves the mark intact; the explicit Unmark action remains the only online mark-removal path.

**Status:** PASS.

### GREQ-SSH-003 — Hanging resume is a clean Backend transaction and frontend tab replacement cleans temporary runtime state

**Git/final-baseline evidence:** final-old resume creates a temporary frontend session, keeps it mounted/active while cached terminal output is replayed, waits for the Backend resume transaction to complete, then optionally replaces an old marked-disconnected tab at the same logical position. If the original marked tab was active the replacement becomes active; if another tab was active, the temporary resume tab may become active only for the handoff and the previous active tab is restored afterward. Failed resume removes the temporary session. The old implementation contained a 135-second frontend ACK/pending-context state machine because cached output ACK/commit was still frontend-driven.

**Required behavior:** the clean frontend does **not** recreate the old ACK/pending-context protocol. Backend `WorkspaceSuspendCoordinatorService.beginResume()` exclusively owns prepare/attach, `TerminalStreamTransport.sendStream()` drains cached output with backpressure, and Backend commit/rollback owns final transport transfer. Frontend `WorkspaceRuntimeRegistry` owns only tab/runtime composition: create a temporary clean runtime, make it active so Terminal has a real consumer, call `WorkspaceRuntimeSession.resume()`, remove the temporary runtime on failure, and restore the previous active tab when appropriate. When resuming a hanging record whose `originalWorkspaceId` still corresponds to a marked-disconnected tab, replace that old tab at the same order position and dispose it only after the new resume succeeds. Manual resume without an old tab still opens the new runtime normally.

**Old-design review:** the clean Backend transaction intentionally supersedes old `SSH_OUTPUT_CACHED_CHUNK` ACKs, pending resume maps and 135-second frontend timers. Only tab-order/active-selection/replacement belongs to the Workspace registry. SSH Suspend feature catalog supplies the hanging record; it does not construct runtime sessions or fetch Connection configs.

**Refactored design/implementation:** VALIDATED — The Backend begin/stream-drain/commit/rollback transaction remains authoritative and no old ACK/pending-context state machine was restored. `WorkspaceRuntimeRegistry` now dedupes a suspended-record resume, inserts/activates one temporary runtime, waits one Vue tick so the new surface can mount before issuing `suspend.resume`, removes that temporary runtime on failure and restores the prior active tab. When the suspended record maps to a marked disconnected original Workspace, the new runtime is inserted at the old tab position and the old runtime is disposed only after Backend resume succeeds; if another tab was previously active it is restored afterward. Ordinary manual hanging resume still creates a normal new tab.

**Status:** PASS.

### GREQ-SSH-004 — Mobile foreground recovery claims the Backend hanging transport or safely falls back to normal reconnect

**Git/final-baseline evidence:** `3572edfa` fixes mobile background/foreground suspend recovery. Browser freeze/background can close the WebSocket after a live tab was marked. Backend takeover is asynchronous, so foreground recovery observes marked disconnected tabs for up to 10 attempts with 400 ms delay, silently refreshes the suspended catalog, matches `hanging.originalSessionId` to the old frontend session id and resumes/replaces it when available. If another tab was active, its active selection is restored after the temporary resume handoff. A final catalog refresh is performed before fallback. Only when no recoverable Backend hanging record exists does the frontend clear its local mark and resume ordinary SSH reconnect, because otherwise the mark would suppress reconnect forever. Final App logic runs this only for mobile after a real hidden→visible transition while the Workspace route is active, and also retries when the user later returns to Workspace while already foregrounded.

**Required behavior:** clean mobile Workspace recovery dedupes concurrent runs, operates only on `markedForSuspend` tabs that are actually disconnected and not already recovering, refreshes the SSH Suspend catalog silently, and uses `originalWorkspaceId` to claim the Backend hanging record through the clean registry replacement transaction. It preserves active-tab semantics. After the final refresh, unresolved marked-disconnected tabs either resume a newly found hanging record or clear only the local consumed/stale mark and call the existing normal reconnect path. Foreground recovery does not unmark an online marked tab and does not run for ordinary unmarked disconnects. Workspace owns the browser visibility/route trigger; the SSH Suspend feature owns catalog refresh/find; registry owns tab replacement.

**Old-design review:** no global Session-store foreground recovery function is restored. `WorkspaceView` already exists only on the Workspace route and is the appropriate browser lifecycle composition point. A narrow public catalog refresh/find API is acceptable for runtime orchestration; private HTTP/wire fields stay in SSH Suspend. A narrow runtime method may clear a stale local suspend mark before fallback reconnect without issuing a bogus unmark request on a disconnected/unbound socket.

**Refactored design/implementation:** VALIDATED — Mobile `WorkspaceView` now tracks real hidden→visible transitions and also retries on a visible Workspace mount. A single in-flight recovery transaction snapshots marked non-connected candidates, performs up to 10 silent catalog refresh attempts at 400 ms intervals, matches only active hanging records by `originalWorkspaceId`, and routes recovery through the registry replacement transaction. The loop stops when the Workspace view unmounts or the device is no longer mobile, so no hidden route can consume a Backend hanging session. A failed resume remains a candidate; after one final successful catalog refresh, a still-present hanging record is retried and never falls back to ordinary SSH reconnect, while only a truly unresolved record clears the stale local mark and invokes the existing reconnect path. Online marked tabs and ordinary unmarked disconnects are untouched.

**Status:** PASS.

### GREQ-WORK-001 — Workspace session lifecycle preserves live runtimes and reconnect semantics without bypassing Workspace binding

**Git/final-baseline evidence:** `d321d113` changed Workspace teardown so route/view unmount only removes UI/event subscriptions and no longer destroys live SSH sessions. `87b26877` changed disconnected-terminal input from “only Enter” to **any terminal key** interrupting reconnect backoff immediately, and consumes that key instead of sending it to a disconnected transport. `d9e2eb8d` then made that path call the existing connection object's `reconnectNow()` rather than creating another session. The final `useWebSocketConnection` distinguishes first-connect failure from post-connect disconnects: before the first successful SSH connection it caps automatic reconnect at 5 attempts; after one successful connection it retries indefinitely with 2s/4s/8s/16s/30s backoff and then 30s periodic retries. A marked-for-suspend session suppresses ordinary reconnect.

**Required behavior:** clean Workspace runtime identity survives Workspace presentation unmount. `WorkspaceRuntimeSession` owns one live session's connect/reconnect/backoff state, keeps the final 2/4/8/16/30-second schedule, stops automatic first-connect retries after 5 failed attempts, and allows post-connect disconnects to continue retrying every 30 seconds. Any user terminal interaction while a reconnectable session is disconnected/reconnecting cancels the delay and starts the runtime reconnect path immediately, but the triggering terminal bytes are not sent until a full `workspace.connect`/resume binding has completed. Terminal input/resize must never reopen a raw Workspace WebSocket independently of RuntimeSession binding.

**Old-design review:** the old Session mega-store and Workspace event bus are not restored. Reconnect policy belongs to `WorkspaceRuntimeSession`; xterm remains transport-agnostic. The Workspace runtime adapter is the correct protocol boundary to gate feature-port `sendInput`/`resize` on a completed Workspace binding, because `WorkspaceSocket.send()` itself may open a raw socket and therefore must not be called from a disconnected Terminal feature path.

**Refactored design/implementation:** VALIDATED — `WorkspaceRuntimeSession` now caps automatic first-connect retries at 5 while retaining the final 2/4/8/16/30-second post-connect schedule. Workspace capability adapters maintain an explicit bound-state gate: Terminal input is consumed while unbound, resize keeps only the latest deferred viewport, and `WorkspaceSocket.sendConnected()` guarantees Terminal feature traffic never reopens a raw socket behind the runtime. Capability gates are dropped immediately on terminal error/close as well as transport close, and an in-flight reconnect handshake cannot be duplicated by another interaction-triggered reconnect.

**Status:** PASS.

### GREQ-WORK-002 — Workspace tabs preserve desktop ordering/context actions while mobile disables drag

**Git/final-baseline evidence:** `297e50c6` introduced SSH-tab drag ordering, `97df12f8` fixed persisted order semantics, `6889dbe5` explicitly disabled drag on mobile, `ccfb93d0` added horizontal wheel scrolling, and `88ad7332` added tab context actions for close / close others / close right / close left. The final tab bar also exposes mark/unmark suspend actions only for eligible connected SSH sessions. Closing an active tab selects the adjacent surviving tab according to the final session ordering.

**Required behavior:** clean registry owns order/activation/removal transactions; presentation emits only tab intents. Desktop tabs support drag reorder and horizontal wheel scrolling. Mobile tabs remain horizontally usable but are not draggable. Context actions expose close/close-others/close-right/close-left according to the target index, and SSH suspend actions read the current reactive runtime state correctly. Closing/reordering never recreates a legacy global Session store or persists stale backend session ids as another source of truth.

**Old-design review:** final-old `localStorage.sessionOrder` existed because the old global Session store reconstructed presentation order from backend-derived ids. Clean `WorkspaceRuntimeRegistry.order` is the live owner and should remain the only runtime order source; this cross-pass preserves observable tab behavior without reintroducing the old persistence coupling.

**Refactored design/implementation:** VALIDATED — Clean registry remains the order/activation owner; desktop drag and horizontal wheel behavior remain intact, while `WorkspaceTabBar` receives explicit mobile presentation context and disables drag/drop on mobile. Context-menu suspend state was rechecked against Vue's deep ref unwrapping and left on the correct current-state path rather than adding an unnecessary compatibility abstraction.

**Status:** PASS.

### GREQ-WORK-003 — Workspace layout preserves splitter lock, resize persistence and final pane multiplicity rules

**Git/final-baseline evidence:** `3ea025d6` introduced `layoutLocked` and applies it to actual splitter interaction, not merely to opening the configurator. `a0a250e3` / `d2b0e74d` fixed visible/draggable splitters. The final `LayoutRenderer.handlePaneResize()` writes resulting child sizes into the matching layout container, and `layout.store.updateNodeSizes()` persists the updated tree with a 1-second debounce. Final `LayoutConfigurator` keeps a local draft, confirms closing with unsaved changes, confirms reset, and treats **Terminal as the only single-instance pane**: when Terminal is used in main layout or sidebars it is removed from the available source, while other panes remain cloneable and may appear multiple times.

**Required behavior:** `workspaceLayout` remains the owner of persisted layout/sidebar configuration. Runtime split resize updates the corresponding container child sizes and persists only the latest value after a debounce; Renderer reports presentation resize and does not perform HTTP itself. `layoutLocked=true` disables mouse/touch/keyboard splitter resizing and maximize/double-click behavior while leaving content usable. The configurator protects unsaved drafts and reset with confirmation. Validation allows repeated non-Terminal pane presentations across the main tree and sidebars, while enforcing at most one Terminal presentation globally and maintaining unique node ids. Sidebar width persistence remains a separate preference concern.

**Old-design review:** no Pinia layout store is restored. Existing clean `workspaceLayout` + Renderer is the correct boundary, but its current global pane-uniqueness validation is an accidental feature reduction. Splitpanes v4 has no lock prop, so lock must be enforced by presentation interaction/CSS and by ignoring resize events while locked; persisted sizes still belong to `workspaceLayout`.

**Refactored design/implementation:** VALIDATED — Runtime splitter `resized` events now flow Renderer → SessionSurface → WorkspaceView → `workspaceLayout.updateNodeSizes()`, where the latest tree is persisted after a 1-second serial debounce; explicit configurator save flushes pending resize work first. Lock state is propagated to Renderer, which disables splitter pointer interaction/maximize/key handling and ignores resize persistence while locked. Validation now enforces only Terminal as globally single-instance while allowing repeated non-Terminal presentations; each individual sidebar still preserves final-old per-side uniqueness. Configurator close/reset confirmations and an in-configurator layout-lock toggle are restored without reintroducing the old Pinia layout store.

**Status:** PASS.

### GREQ-WORK-004 — Workspace focus switching keeps multi-instance focus ownership and final Alt-shortcut grammar

**Git/final-baseline evidence:** final `FocusSwitcherConfigurator` captures shortcuts from `keydown`: modifier-only keys are ignored, Backspace/Delete clears a shortcut, and only **Alt + one ASCII letter or digit** is accepted and normalized to `Alt+X`. The old focus store validates loaded shortcut entries as `Alt+...`, keeps configurable sequence order, and dispatches across multiple registered focus actions until one active/available instance succeeds. Unsaved configurator changes require close confirmation.

**Required behavior:** clean `focusRegistry` remains the multi-instance runtime action owner and `workspaceFocus` remains the persisted sequence/shortcut owner. Alt key release cycles through configured targets; configured direct shortcuts focus the first available matching target. The configurator must capture/normalize the final grammar instead of accepting arbitrary text, allow Backspace/Delete to clear, reject invalid persisted shortcut structures, and preserve existing unsaved-close confirmation.

**Old-design review:** the clean registry already improves ownership by separating runtime actions from persisted target ids. No global DOM query map or old Pinia focus store should return. This slice only restores the final shortcut input contract and validation at the clean owner boundary.

**Refactored design/implementation:** VALIDATED — `workspaceFocus` now validates unique known targets and canonical `Alt+[A-Z0-9]` shortcuts, normalizes valid loaded shortcuts and drops invalid/unknown shortcut entries without discarding the valid sequence. The configurator is readonly text + keydown capture: modifier-only keys are ignored, Backspace/Delete clears, and only Alt plus one ASCII alphanumeric character is accepted and normalized. Existing multi-instance `focusRegistry`, sequence cycling and unsaved-close ownership remain unchanged.

**Status:** PASS.

### GREQ-WORK-005 — Mobile Workspace keeps a content-sized control surface and one shared sticky terminal-modifier state

**Git/final-baseline evidence:** `2666c5bc` fixed mobile Terminal preservation after SSH connect; `9c05c24e` explicitly fixed the mobile command bar so it is a content-sized, non-flexing sibling and cannot consume/collapse the terminal area. `b987b5d6`, `42ef1aef`, and `c97831c7` refined mobile session/file controls. `1bba215d` moved Ctrl/Alt modifier state up to Workspace presentation so the same sticky modifier applies to VirtualKeyboard, system/hardware keyboard input through the command bar, and direct terminal input; the modifier is consumed/cleared after one transformed input and is cleared when the virtual keyboard closes.

**Required behavior:** mobile remains a single-pane Workspace presentation backed by the same live `WorkspaceRuntimeSession`; switching panes does not discard Terminal/file/editor session state or command draft. The bottom command/control area participates in normal vertical layout as a content-sized sibling and does not overlay or collapse the active pane. One transient mobile modifier state at Workspace presentation scope decorates Terminal input for all mobile input surfaces. Ctrl converts eligible one-character input to terminal control sequences, Alt prefixes ESC, combined Ctrl+Alt applies both, and successful consumption clears the sticky modifier. Virtual-keyboard control/navigation/function-key sequences still preserve their terminal escape semantics.

**Old-design review:** sticky Ctrl/Alt is presentation state, not durable RuntimeSession state and not a Terminal-domain setting. Clean composition can decorate the existing `TerminalChannel` in `WorkspaceSessionSurface` so TerminalView, command/system keyboard paths, and VirtualKeyboard converge on one input transform without adding Workspace-specific props to the Terminal feature.

**Refactored design/implementation:** VALIDATED — `WorkspaceSessionSurface` now owns one transient mobile Ctrl/Alt state and exposes a decorated TerminalChannel to the layout/mobile presentation. A Terminal-domain pure modifier helper converts printable Ctrl/Alt sequences plus known virtual-key navigation/function sequences; successful conversion consumes the sticky state. VirtualKeyboard is now controlled rather than owning a second modifier state, and WorkspaceCommandBar captures eligible hardware/system-keyboard `keydown`/`beforeinput` text into the same Terminal path. Leaving the Terminal pane or closing the virtual keyboard clears modifiers. Mobile tools now participate in the surface's normal flex-column flow instead of absolute-overlying the active pane.

**Status:** PASS.
