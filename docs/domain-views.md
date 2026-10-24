# Domain views

Where the generator stops and your app starts.

`ducktpl add` gives you the data side of an app: table, API, tests, types and an
**admin panel** (list, form, delete). That is enough for a back office. It is not
enough for an app people *use*: a booking system needs a calendar, a CRM needs a
pipeline and a customer page, a CMS needs an editor and a public site. A table with
CRUD is the wrong base for all of them, and more layouts of the same admin do not fix that.

This page says how the pieces fit, what exists, and what is planned.

## Two layers

| Layer | What it is | Who writes it |
|---|---|---|
| **Resource** | Headless. The table, the API, the types, and `web/src/resources/<table>.ts`: url, labels, fields, permissions, scope, layout. | `ducktpl` (and `moddb` keeps it in step with the schema) |
| **View** | A React component that draws a resource: table, cards, feed, chat, calendar, and the ones below. | The kit in `web/src/ui/resource/`, or you |

A resource can have any number of views, and a view knows nothing about where its rows
come from. `ducktpl add … --ui <layout>` picks a ready-made one for the generated page;
`--no-ui` writes only the resource and leaves the page to you.

```ts
// web/src/resources/appointments.ts  (generated; moddb edits the fields)
export const AppointmentsDef: ResourceDef = {
  url: '/appointments', label: 'Appointments', one: 'appointment',
  layout: 'calendar', scope: 'studio_id',
  perms: { read: 'appointments.read', write: 'appointments.write' },
  calendar: { start: 'starts_at', end: 'ends_at' },
  fields: [ { name: 'client', label: 'Client', type: 'string', required: true }, … ],
}
```

## What exists

- **`ResourceDef`** (`ui/resource/types.ts`): the contract between a resource and its views.
- **`ResourcePage`**: header, search, scope picker, create/edit dialog, the layout the
  definition asks for. List state (page, search) lives in `lib/list.ts`, a zustand-style
  store from `lib/create.ts`.
- **Layouts**: `table`, `cards`, `feed`, `chat`, `calendar`. `CalendarView` is generic
  (anything with a start and maybe an end; month and week views); the calendar layout feeds it rows.
- **`--no-ui`**: no page, no nav entry, no link: only the resource definition.
- **Permissions**: with the auth module a resource carries `perms {read, write}`. No `read`,
  no nav entry; no `write`, rows are shown but there is no create, edit or delete
  (`lib/access.ts`). The server stays the authority; this only hides what it would refuse.
- **App shell**: the Create button lists one entry per resource (`CREATE` in `App.tsx`);
  `NavItem.under` turns an entry into a tab of another page (Roles under Users).
- **`moddb`** edits the `fields` of the definition on add/remove/rename/change, so a schema
  change never means patching JSX.

## What is planned

Each one is a view over the same `ResourceDef`, built so it is useful on its own:

| View | For | Notes |
|---|---|---|
| **Board** | CRM pipeline, task boards, order status | Columns from an enum field, drag a card to change it. `ui/Kanban.tsx` already does the drag; it needs the resource wiring. |
| **Detail** | Customer or order page | One row as sections: its fields, its related rows (resources that ref it), and a timeline (audit log of that row). |
| **Editor** | CMS posts, pages | A field type richer than `text`: markdown or blocks with preview, media picker, publish state and schedule. |
| **Public site** | CMS, listings | Server-rendered pages from the same rows (the `ssr` module's job), with routes, templates and a sitemap. Not an admin view: it has no login. |
| **Availability** | Booking | Working hours and blocked time per resource (a person, a room); `calendar` shows free slots and refuses overlaps. Partly backend: the check belongs in Go. |

The order that proves the contract is: **Board** (second proof after calendar), then
**Detail**, then **Editor** and **Public site** together, since a CMS needs both.

## Rules for a new view

1. It takes a `ResourceDef` and rows; it does not fetch by itself unless it is a page.
2. It reads what it needs from the definition (`calendar: {start, end}`) and says what is
   missing instead of failing; the generator checks it at `ducktpl add` time
   (`--ui calendar` refuses a resource with no `time` field).
3. It respects `canWrite`: no create/edit/delete affordance without it.
4. A new key in `ResourceDef` is optional, and `moddb` must know how to keep it right when a
   field is added, removed, renamed or changed.
5. It lives in `ui/resource/`, is exported from `index.ts`, and has a layout name for `--ui`.

## Writing your own

Everything above is plain code in your project: copy a layout, or write a page that uses
`CalendarView` / `useResource` / `ResourceDialog` directly and register it in `App.tsx`
(`NAV`, `CREATE`, the `switch` in `Shell`). Use `--no-ui` so ducktpl does not generate a
page you then have to delete. Domain rules that must hold whatever the UI (no double
booking, a status that only moves forward) belong in the Go handler, not in a view.

## Not covered

- Per-row permissions in the UI. rbac grants exist on the server, but the API does not say
  per row what the caller may do, so the UI only knows the global `read`/`write`.
- Nested layouts (a calendar of a board's cards). Compose two pages.
- Real-time collaboration in a view. Live events refetch lists; they do not merge edits.
