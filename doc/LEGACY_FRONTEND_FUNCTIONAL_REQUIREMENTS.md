# Legacy Frontend Functional Requirements

> Status: authoritative functional-parity baseline for the frontend refactor.
>
> Source of truth used to derive this document: the pre-refactor frontend snapshot at
> `/tmp/nexus-old-frontend/packages/frontend/src`, its persisted settings/state models,
> and the existing `test/e2e` behavioral scenarios. Old DOM structure, CSS class names,
> test ids, event-bus names, Pinia store boundaries, HTTP/WS legacy message names, and
> implementation-specific selectors are **not** product requirements.

## 1. Purpose and parity rule

The refactored frontend must preserve the user-visible capabilities and important behavior of the legacy product while replacing the old internal architecture and transport compatibility code.

Functional parity means:

- the same user task can still be completed;
- state that was intentionally persistent remains persistent;
- long-running operations remain cancellable and survive UI panel unmount/hide where the old product did;
- reconnect/suspend semantics preserve the same remote shell/session instead of silently creating a different one;
- mobile/touch workflows remain first-class rather than desktop UI merely shrinking;
- security-sensitive update semantics such as “blank means preserve secret” versus “explicit clear” are preserved;
- protocol names, old selectors, old store/event-bus topology and accidental implementation details do not need to be preserved.

Requirement IDs below are stable references for implementation and final verification.

---

## 2. Authentication, setup and navigation

### FR-AUTH-001 Initial setup

When the backend reports that initial setup is required, the application forces users into Setup before ordinary authenticated routes can be used. Setup creates the initial administrator from username, password and password confirmation.

Special logic:

- password confirmation must match before the setup request is sent;
- setup success completes server initialization but does **not** silently treat the browser as logged in; authentication state is reset and the user is routed to Login;
- while setup is still required, every route except Setup redirects to Setup;
- after setup is complete, revisiting Setup redirects to Login or Dashboard according to the real authenticated state;
- failed setup leaves the form usable for correction/retry instead of leaving a false completed state.

### FR-AUTH-002 Password login and server session

Users can log in with username/password and an optional Remember Me choice. Invalid credentials keep the browser unauthenticated and surface the login failure. A successful login establishes the backend session and opens the authenticated application flow.

Special logic:

- when CAPTCHA is configured, the first-factor login cannot be submitted until the challenge yields a token;
- CAPTCHA widgets/tokens are reset after an attempted first-factor login so retries cannot accidentally reuse an expired challenge;
- after password acceptance that requires TOTP, the same login flow transitions into a six-digit 2FA challenge instead of asking for CAPTCHA again;
- passkey login availability is checked without requiring an already-authenticated session and does not force the password form to disappear.

### FR-AUTH-003 Protected navigation and logout

Authenticated application routes are protected. Logging out clears the server session and returns the user to the unauthenticated flow; directly opening a protected route afterward must not bypass authentication.

### FR-AUTH-004 TOTP 2FA

Users can enable TOTP 2FA, complete the setup/verification flow, be challenged for a TOTP code during subsequent login, and later disable 2FA.

Special logic:

- enabling 2FA is not complete until the verification step succeeds;
- login must distinguish password acceptance from pending 2FA completion;
- disabling 2FA updates the real server-side credential state.

### FR-AUTH-005 Passkeys / WebAuthn

Users can log in with a passkey when available. In Settings they can register passkeys, list them, rename them and delete them.

Special logic:

- passkey authentication may be started for an explicitly-entered username or through a discoverable credential when no username is supplied;
- browser/WebAuthn cancellation or failure returns to the normal login form with an error rather than corrupting authentication state;
- passkey management mutates real backend credentials and refreshes the displayed credential list after changes.

### FR-AUTH-006 CAPTCHA

Administrators can enable/disable CAPTCHA and configure the provider/public configuration for hCaptcha or Google reCAPTCHA. Login renders and validates the configured challenge when the backend requires it.

Special logic:

- secret keys are write-only form values: leaving an existing secret field blank preserves the stored secret instead of clearing it;
- after a successful save, secret inputs are cleared from browser form state;
- non-secret site/public keys may be replaced independently from the secret.

---

## 3. Dashboard

### FR-DASH-001 Connection overview

Dashboard shows connection totals, previously-used count, tags/overview information, recent audit activity, and a quick-connect list.

### FR-DASH-002 Search, tag filtering and sorting

Connection search matches at least connection name, username and host. Users can filter by tag and sort by supported fields such as last connected, name, type, updated and created timestamps.

Special logic:

- selected tag filter, sort field and sort direction persist across a full page reload;
- an unconnected connection is consistently positioned when sorting by “last connected” rather than producing unstable ordering.

### FR-DASH-003 Local resource overview

Dashboard can independently show Nexus host CPU, memory and disk information. Local resource polling uses the configured status-monitor interval and does not block the rest of the dashboard.

### FR-DASH-004 Configured SSH resource overview

Dashboard can independently show low-frequency resource snapshots for configured SSH hosts. Remote refresh uses its own interval, independent of the live Status Monitor interval.

Special logic:

- a slow remote-resource collection must not block connection list, recent activity or local-resource usability;
- only one remote collection request should be in flight at a time even when collection lasts longer than the polling interval;
- new SSH connections become eligible for the next resource status refresh without requiring an application restart;
- loading/empty/error states occupy the resource panel coherently rather than rendering as a small dark partial block.

### FR-DASH-005 Mobile layout

At narrow phone widths the dashboard must not cause page-level horizontal overflow. Search uses a usable full-width row, filtering/sorting controls remain reachable, cards reflow vertically, and each quick-connect action remains comfortably tappable.

---

## 4. Connection, tag, proxy and SSH-key management

### FR-CONN-001 Connection CRUD

Users can create, edit, clone and delete saved connections. Supported connection types are SSH, RDP and VNC. Connection cards show meaningful identity/status metadata and can launch the matching runtime. Saved connections also support free-form notes that survive edit/clone/export flows.

Special logic:

- editing a connection populates non-secret fields such as notes/tags/proxy/jump configuration without exposing stored secrets;
- cloning starts from the selected connection configuration but creates a distinct record/name rather than mutating the source;
- connection management actions available inside Workspace reuse the same Connections feature form/secret semantics as the management page.

### FR-CONN-002 Connection filtering and persisted list preferences

The connection-management page supports search, tag filtering, sorting and sort direction. Its list preferences persist independently from dashboard preferences.

### FR-CONN-003 SSH authentication

SSH connections support password and saved private-key authentication.

Special logic:

- editing an existing password-based connection with a blank password preserves the stored password instead of replacing it with an empty secret;
- editing a saved SSH key name without providing a replacement private key preserves the existing private key.

### FR-CONN-004 Connection testing

SSH connections can be tested before or after saving. Test state is displayed per connection, including success/error and latency where available. “Test all filtered SSH connections” operates on the current filtered set and does not try to test RDP/VNC entries.

### FR-CONN-005 Script / bulk creation mode

The connection form supports a script mode that parses multiple connection definitions and creates multiple saved connections. Parsed names/notes/tags and authentication data must map to the same saved connection model as normal form creation.

### FR-CONN-006 IP-range creation

In add mode, an SSH host field may describe a supported IP range. The product expands the range into multiple connections with deterministic generated names while preserving the chosen common authentication/advanced settings.

### FR-CONN-007 SSH proxy and jump-chain modes

SSH advanced settings support either a configured proxy or an ordered jump-host chain using other saved SSH connections. The connection being edited is not offered as its own jump host.

### FR-CONN-008 RDP and VNC fields

RDP and VNC preserve their connection-specific authentication and advanced options. RDP supports RemoteApp configuration (alias, working directory and arguments).

### FR-CONN-009 Batch selection/edit/delete

Users can enter batch mode, select all, clear selection, invert selection, edit selected connections and delete selected connections.

Special logic:

- batch edit is patch-like: fields left as “no change” are not overwritten;
- explicit “none” for proxy/key is different from “no change”;
- filtered batch deletion deletes exactly the selected ids, including mixed connection types.

### FR-CONN-010 Connection-data export

Settings/Data Management can export connection-related configuration as a downloadable ZIP independently from the full backup workflow. The response filename should honor the backend Content-Disposition filename when present and fall back to a stable Nexus export name.

### FR-TAG-001 Connection tags

Tags can be created, renamed and deleted and assigned to connections from connection forms and Workspace grouping surfaces.

Special logic:

- tag input searches existing tags and excludes tags already selected;
- Enter selects an exact existing tag or requests creation of a new tag when creation is allowed;
- Backspace on an empty tag input removes the last locally-selected tag without globally deleting it;
- global tag deletion is a separate destructive action and removes now-invalid connection associations/caches;
- tag-group management can search connections, select/deselect/invert the filtered set, save membership changes and delete the tag itself;
- absence of a standalone `/tags` route in the final legacy router is intentional evidence that tag management is embedded in reachable connection/Workspace workflows, not a requirement for a separate page.

### FR-PROXY-001 Proxy CRUD

Users can create, edit and delete SOCKS5 and HTTP proxies with name, host, port and optional username/password authentication. Saved proxies can then be selected by connection configuration.

Special logic:

- proxy port must remain within 1–65535;
- an unchanged/blank password in ordinary edit preserves the stored password;
- an explicit password-clear action is represented separately and really clears the backend secret/authentication state;
- entering a replacement password cancels any pending explicit-clear choice;
- destructive proxy deletion requires confirmation and a backend failure is surfaced rather than optimistically removing the record forever.

### FR-SSHKEY-001 SSH key CRUD

Users can add named private keys with an optional passphrase, select saved keys for SSH connection authentication, edit saved key metadata/material and delete keys.

Special logic:

- a new key requires a name and private-key material;
- key lists expose identifier/name, not decrypted private-key contents;
- opening edit never pre-fills private-key or passphrase fields; a blank private-key/passphrase edit means preserve the stored material rather than overwrite it with empty strings;
- supplying new key/passphrase material explicitly replaces only the supplied secret fields;
- deleting a key is destructive and requires confirmation;
- the refactor should not require a frontend “fetch decrypted key details” endpoint merely because the legacy UI called one before intentionally blanking the secrets; preserving the secure edit semantics is the requirement, not exposing decrypted secret material.

---

## 5. Quick Commands and command history

### FR-QC-001 Quick Command CRUD

Users can create, edit and delete Quick Commands with an optional display name and command text. They can execute a Quick Command directly from management UI or a Workspace surface.

### FR-QC-002 Quick Command search

Search matches command name, command text and associated tag names. Search may be always visible or collapsed behind a toggle according to the Workspace preference.

### FR-QC-003 Quick Command tags and grouping

Quick Commands have their own tag set. Commands can have multiple tags and therefore may appear in multiple groups. Untagged commands appear in a dedicated group. Group expansion state persists locally.

### FR-QC-004 Saved variables

A Quick Command may define named variable values and use `${name}` placeholders in command text. Executing the command substitutes defined values. Undefined placeholders surface a warning rather than silently producing a misleading command.

### FR-QC-005 Command display/list ergonomics

The Quick Commands view supports name/command-oriented display, grouped/flattened use in Workspace, row scaling, compact mode and the configured collapsible-search behavior. The management view can switch whether the primary row label emphasizes the saved name or the command text.

### FR-QC-006 Quick Command context actions

A Quick Command can be copied, edited, deleted, executed in the active session or explicitly sent to all live SSH sessions. Context-menu actions and ordinary row buttons share the same execution/variable-expansion path rather than implementing different command semantics.

Special logic:

- copy remains usable on mobile/embedded browser contexts where the modern Clipboard API is unavailable or denied; the refactor may use a shared clipboard utility instead of the legacy temporary-textarea implementation, but the user-visible fallback capability must remain;
- clipboard failure is reported once and does not mutate or execute the command.

### FR-HIST-001 Real terminal history

Commands actually submitted through the terminal command flow are recorded in command history. Users can search, copy, rerun, send an entry to all live sessions, delete individual entries and clear all history with confirmation.

Special logic:

- raw terminal control input such as Ctrl+C is not recorded as a command;
- an empty Enter used to submit a blank shell line or reconnect is not turned into a bogus history item.

### FR-CMD-001 Workspace command input

The Workspace command bar sends entered commands to the active session and offers an explicit action for all applicable sessions. The unsent input draft is scoped to the Workspace session: switching to another live session shows that session's own draft, and switching back restores the original draft until it is submitted/cleared.

Special logic:

- the `commandInputSyncTarget` preference means only `none`, `quickCommands` or `commandHistory`;
- when synchronization is enabled, typing updates that target’s search, Up/Down navigates the target selection, and Enter can execute the selected result;
- this preference must not be reused to choose current-session versus all-session dispatch;
- Enter on an empty connected input sends a real carriage return;
- Enter or another terminal interaction on a disconnected, previously-connected session requests immediate reconnect;
- Ctrl+C with an empty command input sends raw `0x03` without appending a carriage return.

---

## 6. Notifications and audit

### FR-NOTIFY-001 Notification channels

Users can create, edit, persist and delete Webhook, Email and Telegram notification channels.

Supported configuration includes:

- Webhook URL, method, JSON headers and body template;
- Email recipients, body template, SMTP host/port/TLS, optional SMTP username/password and From address;
- Telegram bot token, chat id, message template and optional custom API domain.

Special logic:

- Email accepts multiple recipients in the legacy supported form;
- webhook headers must parse to a JSON object rather than an array/scalar; invalid JSON blocks save/test instead of silently discarding headers;
- editing a channel must not accidentally erase an existing SMTP password or Telegram bot token merely because the secret field is blank/unavailable to the form.

### FR-NOTIFY-002 Test delivery

Notification delivery can be tested without unexpectedly mutating saved configuration.

Special logic:

- a new/unsaved channel is tested from the current form configuration;
- an already-saved channel's legacy Test action tests the saved backend configuration for that id, even if the form currently contains unsaved edits;
- test failures report the delivery failure but do not delete or rewrite the saved channel.

### FR-AUDIT-001 Audit log

Users can review paginated audit entries and filter them by free-text search and supported action type. Visible entries show timestamp, translated action type when known and readable details.

Special logic:

- applying filters resets pagination to page 1;
- changing pages retains the active search/action filters;
- details objects are pretty-printed as JSON; malformed/parse-error data remains inspectable as raw information rather than disappearing;
- unknown action types fall back to their backend identifier when no translation exists;
- loading an additional page should not replace already-visible content with an unrelated full-page spinner unless the list is actually empty.

### FR-FEEDBACK-001 Global feedback and confirmations

User-visible success, warning, information and error feedback is available application-wide, and destructive/important actions can request an explicit confirmation.

Special logic:

- notifications auto-dismiss after a short interval and can be manually dismissed;
- identical error messages are deduplicated for a short window so failing background polling/reconnect loops cannot spam the user;
- warning/success/info messages are not globally collapsed merely because their text matches a previous message;
- confirm dialogs resolve distinctly for confirm versus cancel/Escape/backdrop and ignore duplicate actions while a confirmed operation is already loading;
- feature code uses the shared feedback surface instead of maintaining per-feature toast/confirm implementations.

---

## 7. Settings and security administration

### FR-SET-001 Settings sections

The Settings surface contains the functional areas represented in the legacy product: Security, IP access control, Workspace, System, Data Management, Appearance and About.

### FR-SET-002 Language and timezone

Language and timezone changes persist to the backend and update the UI/runtime as appropriate.

### FR-SET-003 Dashboard resource settings

Local and remote dashboard resource cards can be enabled independently. Local status polling and remote-host snapshot polling have independent intervals.

### FR-SET-004 Workspace/runtime preference inventory

The Settings surface persists the user-facing Workspace/runtime preferences that control the feature behaviors described by the corresponding FRs. The refactor may reorganize the form, but it must not silently drop a supported preference.

The final legacy preference set includes:

- popup File Editor and popup File Manager presentation;
- shared File Editor tabs;
- terminal right-click copy/paste and scrollback limit;
- Workspace sidebar persistence and per-pane widths;
- command-input sync target (`none`, Quick Commands or Command History);
- visibility of connection tags and Quick Command tags;
- Quick Commands collapsible search, compact mode and row scale;
- File Manager delete confirmation, row scale and column widths;
- Spreadsheet rows-per-page and maximum columns;
- Status Monitor refresh interval, scale and IP visibility;
- Docker refresh interval and default-expanded presentation;
- Dashboard local/remote resource visibility and independent remote refresh interval;
- layout lock;
- Workspace top-navigation/header visibility, toggleable from the Workspace tab bar and persisted;
- RDP/VNC modal dimensions;
- language and timezone.

Configuration-schema evolution is versioned independently from SQL schema evolution. Settings key renames/removals/transforms must be applied through the versioned `settings_migrations` history and an atomic migration runner; current frontend/backend code must consume only the current settings schema.

Special logic:

- numeric/scaling values are clamped/validated by their owning feature rather than blindly trusting malformed persisted strings;
- structured width maps fall back to sane defaults per missing/invalid field rather than making the whole UI unusable;
- settings are consumed by the owning feature/runtime through public models/props; they do not justify reintroducing a global Session/Settings mega-store.

### FR-ABOUT-001 Version and release information

Settings/About shows the running frontend version, repository link and latest-release/update information from the configured Nexus repository. A newer release can be opened directly from the About surface.

Special logic:

- release lookup failures and GitHub rate limiting produce an understandable state instead of breaking Settings;
- version comparison uses release/version semantics rather than plain lexical string ordering;
- the repository/release source follows the final product repository configuration, not obsolete historical repository names.

### FR-SEC-001 Change password

The signed-in administrator can change the real login password using the required current/new credential flow.

### FR-SEC-002 IP whitelist

The IP whitelist can be edited and reloaded independently from whether access control is currently enabled.

### FR-SEC-003 IP blacklist / login-ban policy

Administrators can enable/disable blacklist protection and configure login-ban thresholds/durations supported by the backend.

### FR-BACKUP-001 Data backup export/import

Users can export an encrypted full backup and restore from a selected `.nexus-backup` file. The backup covers the supported business configuration/data set, including connections, proxies, SSH keys, tags, Quick Commands, themes/appearance, Workspace settings, background files and custom HTML themes.

Special logic:

- full-backup export requires the current login password for identity verification/encryption and clears that password from browser form state after success;
- account credentials, Passkeys, audit logs and IP ban records are excluded where the backend contract defines them as non-backup data;
- same-instance import may omit the backup password when the backend can decrypt the instance-owned backup; importing a backup produced by another instance requires the original export password;
- import uses the selected file bytes and optional password, reports backend validation/decryption failures, and does not partially pretend success;
- a successful import reports restored row/file counts when returned by the backend, clears sensitive password state and reloads/reinitializes the frontend so in-memory feature stores cannot continue showing pre-restore data;
- Content-Disposition filenames from backup export are honored, with a stable Nexus backup filename as fallback.

---

## 8. Appearance and themes

### FR-APPEAR-001 UI theme selection

The UI supports default/light/dark/custom theme behavior and persists the selected appearance. Reset returns to the shipped default behavior.

### FR-APPEAR-002 Terminal themes and typography

Terminal preset themes are loaded from the application API/configuration, can be selected and persist across reloads. Terminal typography is configurable independently from the theme.

Special logic:

- desktop and mobile terminal font sizes are stored separately so a touch-device adjustment does not overwrite the desktop preference;
- terminal font family persists and is applied to existing/new terminal instances through the Appearance owner;
- interactive Ctrl+wheel/pinch font changes converge on the same persisted values without a stale settings response snapping the UI back.

### FR-APPEAR-003 Custom terminal themes

Users can create, edit, apply and delete custom terminal themes.

Special logic:

- duplicate/conflicting names are surfaced instead of silently overwriting;
- theme export/import preserves the full theme definition;
- importing and editing use the same canonical theme model used by the terminal runtime.

### FR-APPEAR-004 Backgrounds, custom UI/HTML and text effects

The Style Customizer preserves the final legacy appearance capabilities for UI colors, page/terminal backgrounds, local/remote terminal HTML themes and terminal text effects.

Supported behavior includes:

- custom UI theme variables with default/light/dark/reset behavior;
- terminal background image upload, enable/disable, removal and configurable overlay opacity;
- page background image application;
- local HTML presets plus user-created custom HTML presets that can be created, edited/renamed, copied from shipped presets, applied and deleted when allowed;
- a configurable remote HTML-preset repository URL, listing/searching remote presets and applying fetched preset content; clearing the repository disables/clears the remote list;
- terminal text stroke enable/width/color and text-shadow enable/offset/blur/color;
- desktop editor font size/family and mobile editor font size as distinct appearance settings.

Special logic:

- shipped/preset HTML themes are not destructively edited in place; editing a preset creates a custom copy where required by the final product behavior;
- duplicate local preset names are surfaced rather than silently overwriting content;
- failed remote repository/content loading leaves the currently-applied appearance intact;
- Style Customizer presentation state is not a second Appearance data store; applying/saving always converges on the one Appearance owner.

### FR-APPEAR-005 PWA/title-bar theme color

Changing the configured window/theme color updates the browser/PWA theme-color immediately and persists across reload.

### FR-PWA-001 Installable web-app and stale-bundle recovery

The frontend exposes the fixed-URL PWA resources from `public/` (`/manifest.json`, `/sw.js` and manifest icons) and registers the Service Worker from application bootstrap. Static PWA resources may be cached, but HTML and hashed JS/CSS application bundles must not be pinned in a way that traps the client on an obsolete deployment.

Special logic:

- Service Worker registration uses a stable root-scope URL and explicitly checks for updates;
- if router lazy-loading fails with a stale dynamic-import/chunk error after a deployment, the client clears Nexus-owned Service Worker caches, requests a Service Worker update and reloads once;
- a session-scoped recovery marker prevents an infinite reload loop for the same target route;
- the precache list contains only resources that actually exist in `public/`.

---

## 9. Workspace shell and multi-session lifecycle

### FR-WS-001 Multiple live sessions

Workspace supports multiple concurrently-open connection sessions with a tab bar. Switching tabs does not destroy hidden live sessions.

### FR-WS-002 Workspace connection list

Workspace can open a searchable connection list, filtering at least by connection name, host, username and tag. It can launch another session without leaving Workspace.

Special group actions when tag grouping is enabled:

- connect all SSH connections in a tag group;
- manage which saved connections belong to that tag using search/select-all/deselect/invert operations;
- rename/delete the tag through the tag-management flow;
- delete all connections in a real tag group after destructive confirmation;
- the synthetic Untagged group does not offer tag mutation/deletion actions.
- a single connection can be added, edited, cloned or deleted from the Workspace connection-list management context without leaving Workspace.

### FR-WS-003 Session close, ordering and active-tab selection

Closing a tab releases that session’s resources and selects a predictable remaining tab. Desktop session tabs can be reordered by drag-and-drop, and vertical mouse-wheel movement over the tab strip scrolls it horizontally when tabs overflow. The chosen order remains the runtime order used by session cycling/close-left/close-right behavior. Closing a hidden UI pane must not accidentally close the live connection or its background transfer operations.

### FR-WS-004 Reconnect lifecycle

A successfully-connected SSH session automatically retries after an unexpected disconnect with backoff. Any terminal interaction can interrupt the wait and request an immediate reconnect.

Special logic:

- before the first SSH handshake/shell is actually ready, command input is disabled so the first user command cannot be silently lost;
- after at least one successful connection, a disconnected/reconnecting session keeps interaction available because key/input interaction is the immediate-reconnect trigger;
- reconnect only applies after at least one successful connection;
- closing intentionally must not schedule reconnect;
- a reconnect attempt must not create duplicate simultaneous live sockets;
- raw terminal input and the command bar both count as user interaction for immediate reconnect.

### FR-WS-005 Suspended-session lifecycle

A live SSH session can be marked for suspend. When its browser socket disconnects/reloads, the backend keeps the shell/session alive so it can later be resumed.

Special logic:

- marking/unmarking is only presented as successful after the backend confirms the operation;
- normal reconnect must not replace a marked/suspended shell with a fresh SSH login;
- resuming reattaches to the same remote execution context and replays any retained output before committing the resume;
- any terminal snapshot included in suspend handoff is size-bounded and preferentially keeps recent terminal output rather than growing without limit;
- suspended entries can be searched by visible identifying information and distinguish marked/hanging/backend-disconnected state;
- users can rename, resume, terminate, export retained logs and remove suspended entries as supported by the backend;
- exporting a retained log downloads backend bytes using the backend-provided filename when available and reports export failure without mutating the suspended entry;
- background suspended-session polling starts promptly, backs off on HTTP 429/temporary failures up to a bounded interval, recovers toward a normal interval after success, and suppresses repeated identical error toasts; a deliberate/manual load may still surface an error;
- automatic termination events are reflected in the UI.

### FR-WS-006 Workspace layout and popup presentation configuration

Desktop Workspace supports a recursive pane/container layout, left/right sidebars and persisted sizes. Layout can be locked to prevent accidental edits. File Manager and File Editor can also be configured as popup-oriented presentations instead of occupying a fixed pane.

Supported layout editing includes pane/container creation/removal, horizontal/vertical container direction, child ordering/sizing, assigning available panes to the main tree or sidebars, and restoring the shipped default layout/sidebar configuration.

Special logic:

- layout initialization prefers backend-saved layout/sidebar data; if unavailable it may fall back to valid browser-local cache and finally to the shipped default;
- missing node ids can be regenerated as presentation identity; invalid/duplicate/unknown sidebar pane names are rejected rather than rendering an incoherent layout;
- one logical pane should not be accidentally duplicated where the final configuration treats it as a unique placement; the configurator tracks which panes are already used;
- Save persists both main layout and sidebars before closing the configurator; Reset restores both sides of the configuration, not just the visible main tree;
- when popup File Manager is enabled, Command Bar exposes an action that opens the File Manager for the owning active Workspace session;
- when popup File Editor is enabled, Command Bar exposes an editor action and file-open intents reuse the same feature-owned editor tabs/controller;
- mobile keeps File Manager/Editor reachable from the command bar even when desktop popup visibility settings would otherwise hide those buttons;
- switching between embedded/sidebar/popup presentation must not duplicate Filesystem/File Editor business state.
- Workspace can hide/show the application top navigation from the tab bar; this visibility is persisted independently from the pane layout and changes the Workspace usable height without destroying sessions.

### FR-WS-007 Focus switcher

Keyboard focus switching can target the product focus owners: terminal, command input, connection search, file-manager list/search/path input, active file editor, Quick Commands search and Command History search.

Special logic:

- because hidden session surfaces stay mounted, registering the same logical focus target from multiple sessions must not cause a hidden session to steal focus;
- a target is chosen only from currently available/visible owners;
- closing the configurator with unsaved changes asks for confirmation.

---

## 10. Terminal

### FR-TERM-001 Live SSH terminal

SSH sessions render an xterm terminal, accept keyboard/input data and display remote output while the terminal component remains mounted across ordinary Workspace UI changes.

### FR-TERM-002 Resize

Terminal size changes are propagated to the backend PTY. Resize events are bounded/debounced as needed but the latest dimensions must win.

### FR-TERM-003 Font scaling and persistence

Ctrl+wheel/pinch terminal font scaling is bounded and persists. If a session/tab closes immediately after the latest change, the newest value still gets saved rather than being lost to a pending debounce.

### FR-TERM-004 Scrollback and visual options

Configured scrollback limit, terminal font, terminal theme and supported visual options are applied to each terminal instance.

### FR-TERM-005 Clipboard behavior

Desktop right-click copy/paste is controlled by one setting, enabled by default. When enabled, right-click copies the current selection and clears it; when no selection exists, right-click pastes clipboard text. When disabled, the application does not take over desktop terminal right-click. Historical auto-copy-on-select is explicitly superseded and is not part of the current requirement. The terminal also supports Ctrl+Shift+C for selection copy and Ctrl+Shift+V for clipboard paste. Mobile Paste normalizes CR/LF input so pasted shell commands execute as expected.

Special logic:

- clipboard shortcuts/context actions are intercepted locally and are not forwarded as literal Ctrl+Shift key sequences to the remote PTY;
- pasted CRLF/CR text is normalized before terminal paste/input;
- right-click paste uses xterm paste semantics where possible so bracketed-paste mode remains correct;
- clipboard permission failures affect only the clipboard action and do not disconnect or corrupt the terminal session.

### FR-TERM-006 Mobile selection

Mobile long press can select xterm text/words, expose touch selection handles where supported and copy the exact selected terminal text.

### FR-TERM-007 Virtual keyboard

Mobile Workspace exposes a virtual keyboard for terminal-specific keys/modifiers.

Special logic:

- Ctrl and other one-shot modifiers reach the SSH input stream;
- navigation keys generate the correct escape sequences when modifiers are active;
- one-shot modifiers are consumed/reset after use;
- IME composition is allowed to complete before the hidden keyboard sink is cleared.

### FR-TERM-008 Current-directory synchronization

The terminal runtime tracks shell current-directory changes and can synchronize File Manager navigation with the shell.

Special logic:

- directory-change requests reject terminal control characters before writing to the PTY;
- the first directory change waits for a real shell prompt rather than treating arbitrary foreground output as prompt readiness;
- paths containing shell metacharacters are escaped safely;
- requests are correlated/queued so repeated File Manager directory changes do not race one another or inject commands into foreground terminal output;
- File Manager presents queued/success/failure state for the owning Workspace session rather than assuming the globally active session;
- if the old terminal cwd no longer exists, File Manager/terminal synchronization recovers instead of getting permanently stuck.

### FR-TERM-009 Terminal search

Users can search the active terminal scrollback without modifying shell input. Search supports next/previous navigation and clearing the current search decorations.

Special logic:

- Ctrl/Cmd+F opens/focuses terminal search rather than being sent to the remote PTY;
- Enter/Down moves to the next result while Shift+Enter/Up moves to the previous result;
- Escape closes search and returns the command-input/terminal workflow to normal;
- search state belongs to the active terminal presentation and hidden sessions must not steal global search shortcuts.

---

## 11. File Manager

### FR-FS-001 Browse and navigate

File Manager lists remote directories and supports parent navigation, direct path entry and refresh. Desktop opens files on double-click while a normal desktop click owns selection; directory navigation keeps the legacy direct-navigation behavior. Mobile uses the touch-oriented single-tap behavior outside multi-select mode.

Special logic:

- an empty directory still leaves parent navigation available;
- refresh/reconnect of a current directory that was deleted externally falls back to the nearest readable parent instead of leaving the browser permanently unusable;
- directory-load failures/timeouts are scoped to File Manager and do not disable otherwise healthy terminal/session actions.

### FR-FS-002 Recursive search

Search is scoped to the requested directory and can return nested relative paths. File browsing/search remain responsive while unrelated uploads are slow.

### FR-FS-003 Selection and keyboard navigation

Desktop supports normal selection, Ctrl/Cmd toggle selection, Shift range selection and keyboard navigation. Mobile multi-select prevents a tap from accidentally opening a selected file; outside multi-select, a normal single tap opens/navigates according to mobile behavior.

Special logic:

- ArrowUp/ArrowDown navigate the visible sorted/filtered list and wrap at the ends;
- the parent entry participates in keyboard navigation when the current path is not root;
- Enter activates the keyboard-selected item;
- keyboard navigation scrolls the selected row into view and remains aligned when File Manager row scaling changes.

### FR-FS-004 Create/delete/rename/chmod

Users can create folders/files, delete entries, rename entries and change permissions. Delete confirmation obeys the configured setting.

### FR-FS-005 Favorites and path history

Users can manage favorite remote paths and use path history to quickly revisit recent locations.

Favorite-path behavior:

- add, edit and delete favorites with optional display names;
- search by favorite name or path;
- sort by name or most recently used, with the sort choice persisted locally;
- navigating through a favorite updates its last-used timestamp;
- a favorite can also request that the owning terminal change to that path.

Path-history behavior:

- successful navigation records recent paths and displays newest entries first;
- history can be searched, selected for navigation, copied to the system clipboard, deleted entry-by-entry or cleared completely;
- duplicate/history maintenance is owned by the Filesystem feature rather than separate Workspace session state.

### FR-FS-006 Context menu

Right-click/long-press actions expose the operations valid for the target entry, including edit/preview/download, copy/move, rename/delete, chmod and archive actions.

Special logic:

- nested archive submenus remain inside the viewport/narrow sidebar;
- mobile long-press may flatten nested archive actions to keep them tappable.

### FR-FS-007 Symbolic-link semantics

Symbolic links are displayed distinctly. Operations that read/download/preview/copy file content follow the resolved target where the legacy behavior did so, while rename/delete/chmod continue to act on the selected path according to the backend operation contract. Stale or broken symlinks fail as the current remote state rather than reusing cached target metadata.

### FR-FS-008 File Manager display preferences

Row scale and column widths are configurable and persisted. Ctrl+wheel scaling is bounded and uses the latest-value-wins persistence behavior, including when a sidebar is immediately closed.

### FR-FS-009 Remote drag-to-move

On desktop, remote File Manager rows can be dragged onto another directory row or the parent entry to move them within the current Workspace filesystem.

Special logic:

- only valid directory/parent drop targets accept the move; dropping onto the dragged item itself or a non-directory is rejected;
- dragging an item that is already part of the current multi-selection moves the selected set together; dragging an unselected item moves only that item;
- source-equals-destination moves are ignored;
- dragging near the top/bottom edge auto-scrolls the file list while a valid target is active;
- the drag interaction ultimately reuses the normal move capability and does not maintain a second transfer implementation.

---

## 12. Transfers, uploads, downloads and archives

### FR-XFER-001 Multi-file upload

Users can choose or drag multiple local files to the current remote directory. All `DataTransfer.files` are snapshotted at drop time, including Windows-style multi-file drags.

### FR-XFER-001A Folder upload

Desktop drag/drop can include directories. The browser recursively enumerates dropped directory entries, creates required remote directories and preserves each file's relative path. Empty files are valid upload items. Relative paths are normalized and path traversal segments are rejected before remote directory creation/upload.

### FR-XFER-002 Upload streaming/backpressure

Large files stream in chunks rather than being buffered as one huge payload. The browser and server both enforce bounded flow control so the UI/process remains stable on fast, moderate and weak links.

Special logic:

- per-chunk application-level ACK round trips are not required; reliable ordered WebSocket/TCP delivery may be combined with browser send-buffer watermarks and server receive/write backpressure;
- the sender must not blindly enqueue the entire file into browser/Node memory;
- backend chunk order, declared total size and final-chunk consistency are still validated;
- upload data is finalized through a temporary file and the destination is replaced only after server-side stream completion/size validation;
- UI progress is observational and must not become the transport permission signal.

### FR-XFER-003 Upload conflict workflow

When a destination exists, users can choose overwrite or skip and optionally apply that choice to the rest of the current upload batch.

Special logic:

- upload reconnect invalidates stale stream/generation state and re-prepares the directory tree before resuming the local queue;
- apply-to-all affects later conflicts in the same batch only;
- “skip all conflicts” still allows non-conflicting files in that batch to upload;
- the backend remains authoritative for whether an item was skipped/overwritten.

### FR-XFER-004 Cancellation

Uploads, copy/move and archive tasks can be cancelled. Once locally/backend-confirmed cancelled, later stale progress or reconnect events must not resurrect them as running/completed.

### FR-XFER-005 Shared Progress Display

Long-running upload, copy/move, archive and server-to-server transfer work is registered in a shared progress model independent of the File Manager component that initiated it.

Special logic:

- closing/unmounting a File Manager does not orphan an in-flight task;
- hiding a source is presentation-only and must not pause/cancel the underlying operation;
- the floating progress window can hide and later be restored;
- upload/transfer progress shows aggregate progress and transfer-rate information in addition to per-file/task rows;
- aggregate speed is derived from monotonic byte-count deltas over time; transport protocols do not need a second authoritative `speed` state;
- hidden tasks are shown in a shared Progress Display, grouped by source/operation where appropriate, with per-task progress and source-level Cancel All/Restore;
- completed/failed/cancelled/partial statuses remain distinguishable; unknown totals may use indeterminate progress instead of fake percentages;
- the progress window is draggable/resizable, persists a sane position/size where supported and clamps inside the viewport;
- mobile progress UI stays inside the viewport;
- cancelling from the shared Progress Display returns control immediately enough that File Manager refresh/browsing is not blocked on slow remote cleanup.

### FR-XFER-006 File clipboard and cross-session copy/move

File Manager provides a shared file clipboard: selected remote paths can be copied or cut, the user can navigate to another directory or another live Workspace session, and Paste performs the operation into the destination session/current directory.

Special logic:

- Copy keeps clipboard content available for subsequent pastes; same-session Paste reuses the normal remote copy capability;
- same-session Cut/Paste uses the normal move capability and rejects a no-op paste back into the same source directory;
- cross-session Copy runs the authorized cross-session transfer with the source and destination Workspace identities explicitly bound;
- cross-session Cut is intentionally a two-phase operation: copy to the destination first, then delete the source paths only after copy success;
- if source deletion fails after a successful cross-session copy, the copied destination remains intact and the UI reports a partial/warning outcome rather than pretending the move was atomic;
- the clipboard is cleared after a successful Cut only if it still contains the exact source generation that initiated the operation, so a newer user Copy/Cut action is never erased by a late completion;
- transfer progress belongs to the transfer controller/shared Progress Display, not to the clipboard state itself.

### FR-XFER-006A Send Files to saved servers

The File Manager exposes the legacy Send Files workflow for selected source entries. Users can choose one or more saved SSH target connections, specify the remote target path and choose transfer method Auto / rsync / scp. Server-side tasks remain visible/cancellable through the shared Progress Display even if the initiating File Manager closes.

Special logic:

- target connections are grouped by tag plus Untagged; search matches either tag/group name or connection name;
- group checkboxes support select-all and indeterminate partial-selection state;
- multiple target servers can be selected in one submission;
- the owning source connection/session identity and selected source paths/types are included explicitly; the task must not guess its source from whichever Workspace tab happens to be active;
- Send is disabled until at least one target and a non-empty target path are present;
- backend initiation errors leave the modal/input state available for correction/retry instead of closing as if the task started;
- Auto delegates method choice to the backend while explicit rsync/scp preserve the user choice.

### FR-XFER-007 Same-session move semantics

A same-session move treats a missing destination path as available rather than as a fatal stat error.

### FR-XFER-008 Archive operations

Users can compress selected entries and decompress supported archives. Supported normal formats include ZIP, tar.gz and tar.bz2. Password-protected ZIP compression/extraction is supported where the backend environment provides it.

Special logic:

- archive commands and remote filesystem operations resolve the same remote root/path semantics;
- dotfiles keep their actual names when compressing rather than being stripped by archive path handling;
- Unicode ZIP path extra fields must extract Chinese/non-ASCII filenames correctly instead of fallback `#U` escape names;
- a successful archive that skipped some entries reports the backend warning/partial outcome instead of presenting an unconditional clean-success message;
- overlapping archive requests must not silently retarget an already-active task;
- cancelling while remote command preparation is stalled must remain cancelled;
- archive passwords reject NUL/newline characters and excessive length; compression requires confirmation of the password;
- archive passwords are transient UI/request data and are not persisted by Nexus Terminal;
- when using traditional remote zip/unzip password protection, the UI describes its compatibility/security level accurately instead of claiming strong AES encryption.

### FR-XFER-009 Download and inline retrieval

Active Workspace sessions can obtain downloadable remote files/directories using the backend download mechanism. File downloads support HTTP Range where the backend exposes it; directory download produces an archive. Inline preview retrieval respects size limits. Download authorization/tickets are bound to the exact active Workspace session that owns the remote filesystem, not resolved from a connection id alone.

---

## 13. File Editor

### FR-EDIT-001 Multi-tab editor

Multiple text files can be open at once. The active tab is independently tracked and hidden tabs keep their content/state.

### FR-EDIT-002 Desktop/mobile editors

Desktop uses Monaco and mobile uses CodeMirror. Opening Markdown from Preview can switch into the editor and save through the same remote file capability. Both presentations consume the same File Editor session/controller rather than owning duplicate document state.

Special logic:

- a desktop popup editor can be resized and its browser-local desktop size is restored on the next open;
- mobile popup editing uses the current mobile viewport/fullscreen surface and never writes that viewport size back over the saved desktop popup size;
- resizing a presentation re-layouts the editor without recreating the document/tab state.

### FR-EDIT-003 Save, refresh and shortcuts

Saving writes through the authorized Workspace file capability. Monaco supports Ctrl/Cmd+S. Dirty/save/error state is visible. Users can force-refresh the active remote file; if it is dirty, the UI asks before discarding local unsaved edits, then re-reads the remote content and detected encoding.

### FR-EDIT-004 Encodings

Users can reload a file using supported text encodings and save using the selected encoding.

Special logic:

- decoding/encoding must support the backend-supported set such as UTF variants, GBK/GB18030, Big5/Shift-JIS where available; browser-only `TextDecoder` support must not narrow legacy capability;
- BOM handling is preserved for UTF-16 writes;
- encoding changes re-read the original remote bytes rather than transcoding the already-decoded string in place.

### FR-EDIT-005 Line endings

The editor detects the active text line-ending style and lets users convert the current document between LF, CRLF and CR. Conversion changes the document text/dirty state and saving writes the selected line endings rather than silently normalizing them back.

### FR-EDIT-006 Tab management

Tabs support close, close others, close left and close right. Alt+Left/Right switches editor tabs. Legacy close behavior did not block close on dirty state; parity must not invent a mandatory unsaved-changes modal unless product requirements are deliberately changed later.

### FR-EDIT-007 Per-tab editor view state

Each editor tab retains its own vertical and horizontal scroll position. Switching away and back restores that tab's position in both embedded and popup editor presentations where the same tab controller is reused.

### FR-EDIT-008 Shared/per-session tabs

Where the Workspace preference enables shared editor tabs, compatible sessions share the editor tab surface; otherwise tabs remain scoped to the Workspace session.

### FR-EDIT-009 Syntax highlighting and editor search

File Editor identifies language from the remote filename/extension and applies syntax highlighting for the common language families supported by the legacy editors, falling back safely to plaintext for unknown files. Desktop Monaco and mobile CodeMirror provide normal in-document search.

Special logic:

- language identity follows the active tab/file and changes when a different tab becomes active without creating duplicate document state;
- common mappings include JavaScript/TypeScript, JSON, HTML/CSS, Python, Java/C/C++/C#, Go, PHP, Ruby, Rust, SQL, shell, YAML, Markdown, XML/INI/batch/Dockerfile where supported by the editor runtime;
- mobile search is explicitly reachable from the editor UI in addition to CodeMirror keyboard search support;
- unsupported or failed language-pack loading falls back to editable plaintext rather than preventing the file from opening.

---

## 14. File Preview

### FR-PREV-001 Supported preview types and provider loading

Inline preview supports images, Markdown, PDF, spreadsheet formats (XLSX/XLS/CSV as supported) and DOCX. Unsupported types fall back to the text editor/download path rather than rendering stale prior preview content. Preview implementations may be lazy-loaded by provider/type.

Special logic:

- provider selection follows file/type capability rather than whichever preview component was previously active;
- provider/runtime preloading is an optimization only: preload failure is cleared/retryable and normal Open still attempts the preview instead of permanently disabling that type;
- switching to a different provider/document must dispose provider-specific resources such as PDF loading tasks/object URLs without destroying other preview tabs.

### FR-PREV-002 Size limits

Preview rejects oversized inline loads before expensive binary retrieval/rendering. Final legacy limits are Markdown **2 MiB**, Spreadsheet **10 MiB**, and Image/PDF/DOCX **20 MiB**. Oversize files show a clear “too large for inline preview” state and remain available for editor/download workflows.

### FR-PREV-003 Multi-tab preview workspace

Preview tabs can keep heterogeneous image/PDF/spreadsheet/DOCX documents open together. Switching tabs preserves per-document UI state such as PDF page and selected spreadsheet sheet.

### FR-PREV-004 Hide versus close

Preview hide and preview close are distinct.

Special logic:

- with popup file editing enabled, clicking the popup backdrop/X hides the preview workspace but preserves cached tabs;
- the Preview component’s explicit Close action clears cached preview tabs in popup mode;
- with popup file editing disabled, returning from Preview to Editor hides Preview but preserves its tabs;
- reopening a preserved tab does not unnecessarily refetch until Refresh is requested.

### FR-PREV-005 Refresh

Refresh force-reloads the remote bytes and rerenders the active document. Markdown/image/PDF/XLSX/DOCX must all reflect external file changes after Refresh.

Special logic:

- PDF refresh preserves the current page where valid;
- spreadsheet refresh preserves the selected sheet where it still exists;
- image refresh uses new object/blob data rather than a browser-cached stale URL.

### FR-PREV-006 Unified document search

PDF, spreadsheet and DOCX previews expose a consistent search interaction: search button / Ctrl/Cmd+F opens search, input receives focus, Enter/Shift+Enter or next/previous navigates matches, count is visible, and Escape/close hides and clears search.

Special logic:

- hidden preview tabs must not steal the global Ctrl/Cmd+F shortcut;
- PDF highlights the active text occurrence and navigates to its page;
- spreadsheet search can navigate across sheets/pages and marks the active cell;
- DOCX wraps textual matches in `<mark>`-style highlights and identifies the active match.

### FR-PREV-007 PDF interaction

PDF supports continuous scrolling, page indicator/navigation, outline navigation, fit-width/manual zoom, mobile overlay outline drawer and pinch zoom. Refresh and tab switching preserve useful page/scroll state.

Special logic:

- hiding a mounted preview and showing it again restores continuous-scroll position/current-page state rather than jumping to the first page;
- a requested page/outline jump is deferred until the target and preceding page metrics are measured, avoiding jumps to wrong offsets during lazy rendering;
- resize measurements from hidden pages/surfaces are ignored so they cannot corrupt later scroll tracking;
- desktop outline visibility can be persistent, while mobile uses the drawer/toggle interaction without forcing the desktop preference.

### FR-PREV-008 Spreadsheet interaction

Spreadsheet preview supports sheet tabs, search, row pagination and a configurable maximum column count.

Special logic:

- search walks all loaded worksheet rows/sheets within the configured preview column limit, can jump across sheets/pages and highlights both matches and the active match;
- PageUp/PageDown switch pages, while arrow keys pan the visible grid without changing the underlying workbook state;
- selecting a different sheet resets that sheet view to page 1; refresh attempts to preserve the previously-selected sheet by name;
- the final short page contains only real remaining rows and does not create artificial blank placeholders;
- first-row/header emphasis applies only on the first page rather than incorrectly styling the first row of every paginated page;
- a configured maximum-column limit truncates rendering/search scope consistently and surfaces that truncation to the user rather than silently pretending the workbook has fewer columns.

### FR-PREV-009 Wide-content horizontal scrolling

PDF, spreadsheets and DOCX expose a dedicated bottom horizontal scrollbar on desktop when content is wider than the viewport. The main content owns one horizontal scroll position; spreadsheet sheet-tab horizontal scrolling remains independent.

Special logic:

- the bottom track hides when content fits;
- touch devices can pan wide content directly even though the desktop scrollbar track is hidden.

---

## 15. Status Monitor and Docker

### FR-STATUS-001 Live server status

Workspace can start/stop periodic remote status sampling and display CPU, memory, swap, disk/network/IP data supported by the backend. Refresh interval and panel scale follow Settings.

Special interaction:

- the displayed IP/host can be copied;
- on mobile, the command/terminal tool surface can open Status Monitor as a dedicated modal without requiring the status pane to be the active Workspace pane;
- users can select a primary metric/history view instead of being forced to inspect every graph at once;
- history can be viewed at 1/5/10/30-minute ranges supported by the accumulated sample buffer;
- switching metric/range is local presentation state and must not restart the remote sampler;
- long histories are downsampled using buckets anchored to the monotonic sample sequence so completed historical buckets remain stable as the sliding window advances;
- network history preserves short spikes when downsampling and keeps a stable display scale instead of rescaling violently on every sample;
- hover/tooltip state is presentation-only and never changes sampler ownership or polling cadence.

### FR-DOCKER-001 Container list/status

Docker manager lists remote containers and refreshes status/statistics at the configured interval.

### FR-DOCKER-002 Container actions

The Docker surface supports start, stop, restart and remove through the Docker backend capability, then refreshes displayed state. Running containers also expose Enter and Logs actions. Default expanded/collapsed container presentation follows the Workspace preference.

Special logic:

- Enter and Logs are terminal command intents ('docker exec ... sh' and 'docker logs ... -f') executed in the owning Workspace terminal; they are not separate Docker transport/backend APIs;
- expanded rows can show container statistics such as CPU, memory and network I/O;
- destructive remove requires confirmation;
- Docker polling/action state remains feature-owned while Workspace only routes terminal-command intents.

---

## 16. Remote Desktop (RDP/VNC)

### FR-RD-001 Browser remote desktop

Saved RDP and VNC connections can open a Guacamole-based browser remote desktop using the authorized remote-desktop tunnel.

### FR-RD-002 RDP RemoteApp

RDP RemoteApp alias/directory/arguments saved on the connection are passed into the remote session. Normal RDP remains available when RemoteApp is disabled.

### FR-RD-003 Resize/display updates

Remote desktop forwards viewport/display size updates without requiring a reconnect for ordinary resizes.

### FR-RD-004 Fullscreen and minimized-window semantics

Remote desktop supports browser fullscreen. Pointer resize and dragging/restoring the minimized control preserve the same window semantics for RDP and VNC.

### FR-RD-005 Clipboard synchronization

RDP and VNC synchronize plain-text clipboard data in both directions when browser permissions allow it. Focusing the remote display can push the current host clipboard into the remote session; Guacamole clipboard streams received from the remote side are written back to the host clipboard. Permission failures must not disconnect the remote session.

### FR-RD-006 Mobile touch modes

Touch input can switch between direct-touch and touchpad-style modes. Changing mode persists for the current product preference/session and does not reconnect the remote desktop.

Special logic:

- clicking/tapping the remote display restores the appropriate keyboard focus so VNC/RDP key events continue after interacting with window controls;
- mobile taps focus a hidden text-control sink so the system keyboard can open, while IME composition is allowed to finish before the sink is cleared;
- clipboard or browser-focus permission failures degrade that auxiliary capability only and must not tear down the Guacamole session.

### FR-RD-007 VNC explicit text input

The VNC window provides an explicit text-entry/send control in addition to direct keyboard capture/clipboard sync. Sending text synthesizes remote key input while the Guacamole session is connected.

Special logic:

- focusing the helper input temporarily prevents the global VNC keyboard listener from also consuming the same keystrokes;
- Enter or the Send action submits the helper text only when connected and non-empty;
- helper-input failure is surfaced as an input error without reconnecting or replacing the VNC session.

---

## 17. Mobile Workspace

### FR-MOB-001 Terminal-first layout

On phones, Workspace prioritizes terminal space while keeping touch-only tools reachable from a mobile command bar/pane selector.

### FR-MOB-002 Quick Commands surface

The mobile command bar can open a touch-friendly Quick Commands surface and dismiss it with normal modal/Escape behavior.

### FR-MOB-003 File workflows

Mobile File Manager supports tap navigation, multi-select without accidental opens, long-press context actions, drag/upload where the platform exposes files, CodeMirror editing and Preview workflows.

### FR-MOB-004 Transfer/progress overlays

Floating progress and shared Progress Display remain within the viewport and can be hidden/restored/cancelled without blocking the underlying Workspace.

---

## 18. Runtime-independent implementation constraints

These are functional preservation constraints derived from the refactor goal rather than legacy implementation details.

### FR-ARCH-001 Feature capability ports

Terminal, filesystem, editor, preview, transfer, status, Docker, suspend and remote-desktop features depend on capability ports. Workspace and Agent runtimes may implement those ports separately. Feature components must not depend directly on a concrete Workspace socket.

### FR-ARCH-002 Live Workspace ownership

One Workspace runtime/session owner manages the live connection and creates adapters for the features. Lower-level features do not create or own the Workspace WebSocket/session lifecycle.

### FR-ARCH-003 Official HTTP/WS Interface contract only

The completed refactor uses the new official frontend-backend HTTP/WebSocket Interface contract directly. Production frontend must not depend on historical `ssh:*`, `sftp:*`, `SSH_*`, NXTM/NXUP framing or snake_case legacy transport DTOs. Backend legacy HTTP/WS Interface compatibility directories are removed after migration.

### FR-ARCH-004 Latest-value persistence

Fast UI preferences that may save repeatedly (font size, panel scale, width, etc.) use latest-value-wins persistence. A slow earlier response must not overwrite a newer user choice, and component unmount immediately after a change must flush the newest value where legacy behavior required it.

---

## 19. Final parity acceptance

Before declaring the refactor complete:

1. Every requirement above has a concrete implementation owner in the new architecture.
2. Frontend architecture and i18n checks pass.
3. Frontend/backend TypeScript builds pass.
4. Production code no longer imports or emits legacy HTTP/WS contract names targeted for removal.
5. Backend `interfaces/http/legacy-api` and `interfaces/websocket/legacy-api` are deleted after the clean frontend migration is complete.
6. Only then are the existing E2E scenarios run. Selector-only failures may update existing test locators; product code is not distorted to preserve stale selectors.
7. No new unit/component/integration/E2E tests are introduced as part of this refactor unless the execution policy is explicitly changed later.
