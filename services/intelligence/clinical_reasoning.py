"""Deterministic clinical reasoning support for ClinAI.

This module does not diagnose or prescribe. It converts tenant-scoped structured
patient data into auditable review signals, longitudinal changes, unresolved
workflow gaps and data-quality findings. Probabilistic language models can use
these signals as evidence, but the signals themselves are deterministic.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _s(value: Any) -> str:
    return str(value or "").strip()


def _num(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _date(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _days_open(value: Any, now: datetime) -> int | None:
    dt = _date(value)
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    current = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return max(0, (current - dt).days)


def _records(context: dict[str, Any], *names: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name in names:
        value = context.get(name)
        if isinstance(value, list):
            out.extend(x for x in value if isinstance(x, dict))
    return out


def _text(record: dict[str, Any]) -> str:
    keys = ("name", "testName", "displayName", "description", "title", "valueText", "diagnosis", "medicationName", "genericName")
    return " ".join(_s(record.get(k)) for k in keys).lower()


def _sort_newest(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda x: _date(x.get("recordedAt") or x.get("createdAt") or x.get("performedAt") or x.get("date")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


def analyze_clinical_context(context: dict[str, Any], question: str = "", now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    signals: list[dict[str, Any]] = []
    facts: list[str] = []
    changes: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    data_quality: list[str] = []

    vitals = _sort_newest(_records(context, "observations", "vitals"))
    labs = _sort_newest(_records(context, "labResults", "laboratoryResults", "results"))
    meds = _records(context, "medications", "medicationOrders", "medicationOrdersActive")
    allergies = _records(context, "allergies")
    diagnoses = _records(context, "diagnoses")
    encounters = _sort_newest(_records(context, "encounters"))
    appointments = _sort_newest(_records(context, "appointments"))
    referrals = _sort_newest(_records(context, "referrals"))
    tasks = _sort_newest(_records(context, "careTasks", "tasks"))
    alerts = _sort_newest(_records(context, "clinicalAlerts", "alerts"))
    followups = _sort_newest(_records(context, "followUps", "followups"))
    orders = _sort_newest(_records(context, "clinicalOrders", "orders"))
    imaging = _sort_newest(_records(context, "imagingStudies", "imaging"))
    admissions = _sort_newest(_records(context, "admissions"))

    if encounters:
        facts.append(f"{len(encounters)} encounter record(s) are available in the retrieved context.")
    if diagnoses:
        names = [_s(x.get("name") or x.get("diagnosis") or x.get("display")) for x in diagnoses]
        names = [x for x in names if x]
        if names:
            facts.append("Recorded diagnoses include: " + ", ".join(dict.fromkeys(names[:12])) + ".")

    # Explicit critical/abnormal laboratory signals take precedence over generic inference.
    for lab in labs[:100]:
        abnormal = _s(lab.get("abnormalFlag") or lab.get("abnormal_flag")).lower()
        critical = bool(lab.get("critical"))
        if critical or abnormal not in {"", "normal", "within-range", "within range"}:
            label = _s(lab.get("testName") or lab.get("name") or "laboratory result")
            value = _s(lab.get("valueNumeric") if lab.get("valueNumeric") is not None else lab.get("valueText"))
            status = "critical" if critical else f"flagged {abnormal}"
            signals.append({"severity": "urgent" if critical else "attention", "type": "laboratory", "signal": f"{label}: {value} ({status})", "sourceId": lab.get("id")})

    # Vitals: deliberately conservative review thresholds, not diagnoses.
    for v in vitals[:80]:
        systolic = _num(v.get("systolic") or v.get("systolicBp") or v.get("systolicBP"))
        diastolic = _num(v.get("diastolic") or v.get("diastolicBp") or v.get("diastolicBP"))
        hr = _num(v.get("heartRate") or v.get("pulse"))
        spo2 = _num(v.get("spo2") or v.get("oxygenSaturation"))
        rr = _num(v.get("respiratoryRate") or v.get("respRate"))
        temp = _num(v.get("temperatureC") or v.get("temperature"))
        if systolic is not None and systolic >= 180:
            signals.append({"severity": "urgent", "type": "vital", "signal": f"Recorded systolic blood pressure {systolic:g} mmHg needs prompt clinical review.", "sourceId": v.get("id")})
        elif systolic is not None and systolic >= 160:
            signals.append({"severity": "attention", "type": "vital", "signal": f"Recorded systolic blood pressure {systolic:g} mmHg is markedly elevated and should be reviewed in context.", "sourceId": v.get("id")})
        if diastolic is not None and diastolic >= 120:
            signals.append({"severity": "urgent", "type": "vital", "signal": f"Recorded diastolic blood pressure {diastolic:g} mmHg needs prompt clinical review.", "sourceId": v.get("id")})
        if spo2 is not None and spo2 < 90:
            signals.append({"severity": "urgent", "type": "vital", "signal": f"Recorded oxygen saturation {spo2:g}% is very low and needs prompt clinical review.", "sourceId": v.get("id")})
        elif spo2 is not None and spo2 < 94:
            signals.append({"severity": "attention", "type": "vital", "signal": f"Recorded oxygen saturation {spo2:g}% is below the usual adult target range and should be reviewed with clinical context.", "sourceId": v.get("id")})
        if hr is not None and (hr >= 130 or hr < 45):
            signals.append({"severity": "attention", "type": "vital", "signal": f"Recorded heart rate {hr:g}/min is outside a broad adult review range.", "sourceId": v.get("id")})
        if rr is not None and rr >= 30:
            signals.append({"severity": "attention", "type": "vital", "signal": f"Recorded respiratory rate {rr:g}/min is elevated and should be reviewed.", "sourceId": v.get("id")})
        if temp is not None and temp >= 39.5:
            signals.append({"severity": "attention", "type": "vital", "signal": f"Recorded temperature {temp:g}°C is high and should be interpreted with the clinical picture.", "sourceId": v.get("id")})

    # Medication/allergy name overlap is a safety review signal only.
    allergy_text = " ".join(_text(a) for a in allergies)
    for med in meds:
        med_name = _s(med.get("medicationName") or med.get("name") or med.get("genericName"))
        if med_name and med_name.lower() in allergy_text:
            signals.append({"severity": "urgent", "type": "medication-allergy", "signal": f"A medication name appears to overlap with a recorded allergy entry: {med_name}.", "sourceId": med.get("id")})

    # Workflow gaps.
    for order in orders:
        status = _s(order.get("status")).lower()
        if status in {"ordered", "pending", "in-progress", "in_progress"}:
            signals.append({"severity": "attention", "type": "unresolved-order", "signal": f"A clinical order remains {status} without a matching completed result in the retrieved context.", "sourceId": order.get("id")})
            gaps.append({"type": "order-result", "sourceId": order.get("id"), "status": status})
    if imaging:
        for study in imaging:
            status = _s(study.get("status")).lower()
            if status in {"ordered", "scheduled", "pending"}:
                gaps.append({"type": "imaging-follow-through", "sourceId": study.get("id"), "status": status})
                signals.append({"severity": "attention", "type": "imaging", "signal": f"An imaging study remains {status} in the retrieved record.", "sourceId": study.get("id")})

    for referral in referrals:
        status = _s(referral.get("status")).lower()
        age = _days_open(referral.get("createdAt") or referral.get("created_at"), now)
        if status not in {"completed", "closed", "cancelled"} and age is not None and age >= 7:
            signals.append({"severity": "attention", "type": "referral", "signal": f"A referral has remained open for about {age} days.", "sourceId": referral.get("id")})
            gaps.append({"type": "delayed-referral", "sourceId": referral.get("id"), "daysOpen": age})

    for task in tasks:
        status = _s(task.get("status")).lower()
        priority = _s(task.get("priority")).lower()
        if status in {"open", "pending", "in-progress", "in_progress"} and priority in {"critical", "urgent", "high"}:
            signals.append({"severity": "urgent" if priority == "critical" else "attention", "type": "care-task", "signal": f"An open {priority} care task remains: {_s(task.get('title')) or 'untitled task'}.", "sourceId": task.get("id")})

    for f in followups:
        status = _s(f.get("status")).lower()
        due = _date(f.get("dueAt") or f.get("scheduledAt") or f.get("followUpAt"))
        if due and due < now and status not in {"completed", "closed", "cancelled"}:
            signals.append({"severity": "attention", "type": "follow-up", "signal": "A recorded follow-up date has passed without a completed status.", "sourceId": f.get("id")})
            gaps.append({"type": "overdue-follow-up", "sourceId": f.get("id")})

    # Longitudinal vital changes, grouped by common names.
    series: dict[str, list[tuple[datetime, float, str | None]]] = {}
    for v in vitals:
        dt = _date(v.get("recordedAt") or v.get("observedAt") or v.get("createdAt"))
        if not dt:
            continue
        for key, value in (("systolic", v.get("systolic") or v.get("systolicBp") or v.get("systolicBP")), ("diastolic", v.get("diastolic") or v.get("diastolicBp") or v.get("diastolicBP")), ("heartRate", v.get("heartRate") or v.get("pulse")), ("spo2", v.get("spo2") or v.get("oxygenSaturation")), ("temperature", v.get("temperatureC") or v.get("temperature"))):
            n = _num(value)
            if n is not None:
                series.setdefault(key, []).append((dt, n, v.get("id")))
    for key, rows in series.items():
        rows = sorted(rows, key=lambda x: x[0])
        if len(rows) >= 2:
            first, latest = rows[0][1], rows[-1][1]
            delta = latest - first
            if abs(delta) > max(abs(first) * 0.15, 1.0):
                changes.append({"measure": key, "from": first, "to": latest, "absoluteChange": round(delta, 3), "sourceIds": [rows[0][2], rows[-1][2]]})

    if admissions:
        active = [a for a in admissions if _s(a.get("status")).lower() not in {"discharged", "closed", "cancelled"}]
        if active:
            facts.append(f"An active admission record is present ({len(active)} active admission record(s)).")
    if appointments:
        upcoming = [a for a in appointments if (_date(a.get("startAt") or a.get("scheduledAt") or a.get("start_at")) or now) >= now and _s(a.get("status")).lower() not in {"cancelled", "completed"}]
        if upcoming:
            facts.append(f"{len(upcoming)} upcoming appointment record(s) are present in the retrieved context.")

    if not vitals and not labs and not encounters:
        data_quality.append("The retrieved context contains limited clinical observations, laboratory results and encounter data; conclusions should remain narrow.")
    if not diagnoses:
        data_quality.append("No diagnosis records were retrieved; do not infer a diagnosis from symptoms alone.")
    if not meds:
        data_quality.append("No medication records were retrieved; medication reconciliation cannot be confirmed from this context.")

    severity_rank = {"urgent": 0, "attention": 1, "informational": 2}
    signals.sort(key=lambda x: severity_rank.get(x.get("severity", "informational"), 3))
    return {
        "engine": "clinai-deterministic-clinical-reasoning-v1",
        "purpose": "clinical review support, not autonomous diagnosis or treatment",
        "questionFocus": _s(question)[:1000],
        "recordedFacts": facts[:30],
        "reviewSignals": signals[:60],
        "longitudinalChanges": changes[:30],
        "workflowGaps": gaps[:40],
        "dataQuality": data_quality[:20],
        "counts": {"vitals": len(vitals), "labs": len(labs), "medications": len(meds), "diagnoses": len(diagnoses), "encounters": len(encounters), "appointments": len(appointments), "referrals": len(referrals), "tasks": len(tasks), "alerts": len(alerts), "orders": len(orders), "imaging": len(imaging), "admissions": len(admissions)},
        "safety": "Signals identify records that deserve professional review. They are not diagnoses, prescriptions, triage decisions or irreversible clinical actions.",
    }
