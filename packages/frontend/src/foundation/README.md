# Frontend foundation

This directory contains business-agnostic primitives that feature modules import and compose themselves.

Dependency direction:

```text
foundation  <-  feature/component/view
```

Foundation code must not import application stores, feature modules, workspace events, or protocol/business state. It provides reusable mechanics only; each consumer owns visibility, lifecycle, persistence keys, API calls, and feature-specific side effects.

- `ui/`: reusable visual shells such as overlay/backdrop/panel structure.
  - `OverlayPanel` owns shared shell presets such as `standard-modal`; feature components should prefer a preset over duplicating width, max-height, padding, radius, or shadow classes.
- `interaction/`: input/gesture mechanics such as wheel scaling, element resizing, resize handles and bounded dragging.
- `async/`: generic async coordination such as latest-value persistence.

Do not turn foundation into a registry that knows which feature modules exist. New features should import the primitives they need.
