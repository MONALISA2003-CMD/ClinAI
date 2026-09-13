# ClinAI Design System and Responsive Architecture V1

## Purpose

This release establishes the visual identity and responsive application shell before V14 clinical feature work.

## Brand authority

The supplied ClinAI logo is the source of truth for the product identity. The interface uses the logo's deep clinical blue, medical red and white as the primary brand language.

Primary tokens:

- ClinAI Blue: `#04366b`
- ClinAI Blue 2: `#0a4b8f`
- ClinAI Blue Soft: `#eef5fc`
- ClinAI Red: `#d80c1f`
- ClinAI Red Soft: `#fff0f2`
- Surface: `#ffffff`
- Application background: `#f7f9fc`
- Ink: `#142033`

Red is reserved for critical clinical meaning and selected identity accents. Blue remains the dominant interaction colour.

## Responsive product principle

> ClinAI does not shrink. ClinAI reorganizes.

### Laptop / desktop

Full clinical workstation:

- Persistent grouped navigation
- Full search and status header
- Multi-column command centre
- Six metric cards
- Workspace forms and record lists
- Patient 360 and encounter workspaces
- Clinical journey visible as a connected workflow

### Tablet

Adaptive clinical workstation:

- Compact navigation rail
- Drawer for the complete module tree
- Three-column metric layout where space permits
- Three-column form layout that collapses naturally
- Same data model and workflows as desktop

### Mobile

Task-first clinical workspace:

- Compact top bar
- Dedicated patient/record search field
- Two-column priority metrics
- Four quick actions
- Five-item bottom navigation: Home, Patients, Queue, Tasks, More
- Complete module tree available from the More drawer
- Clinical journey shortened on the command centre and available in patient context
- Forms collapse to one field per row
- Record actions remain touch-friendly
- Modals use almost the full viewport without exceeding the safe screen area

## Navigation architecture

Desktop uses grouped navigation. Tablet uses a navigation rail plus drawer. Mobile uses bottom navigation plus a drawer. The underlying module identifiers remain unchanged so navigation does not create duplicate application logic.

## Clinical UX guardrail

The responsive work is presentation architecture only. Clinical decision logic, clinical content and interoperability claims remain governed by the existing ClinAI backend and clinical governance model.
