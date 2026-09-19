# Phase 6–7 Implementation Details

## Connected workflows

### Finance
Encounter/service → invoice → claim/coverage → payment → reconciliation → accounting.

### Inventory and procurement
Need/low stock → procurement request → approval → purchase order → supplier → receipt → inventory batch → stock movement.

### Public health
Surveillance event → case → investigation → response task → human review.

### Engagement
Patient → portal/communication → notification/document → telemedicine/remote monitoring → follow-up.

## Safety design

All new writes use the existing authorization path. Organization scope is applied before mutation. Relationship-bearing public-health records are checked against the same organization before creation. Procurement receipt is transactional and locks the purchase order and purchase-order lines before creating inventory batches and stock movements.

## Empty-state design

When authoritative public-health data is absent, dashboards show the absence of activity instead of fabricated values.

## Regression-sensitive fixes found during final audit

1. Insurance organization tenancy was missing in the live policy table.
2. Investigations/Response contracts incorrectly implied direct patient ownership.
3. Payment dashboard status/amount fields needed explicit table aliases.
4. Payment worklist ordering attempted to coalesce a timestamp with a UUID.
5. The runtime insurance schema guard was initially placed inside an existing SQL template; the full API compiler caught and corrected this.

## Final principle

The Phase 6–7 implementation extends the existing ClinAI system and reuses existing authoritative data and specialist workspaces. It does not create a second competing clinical truth.
