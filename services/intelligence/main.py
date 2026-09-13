"""ClinAI deterministic computation and analytics engine.

This service performs calculations and analytical operations that should not be
left to probabilistic text generation. It is intentionally stateless: callers
provide the values/data required for each operation and receive auditable,
deterministic results.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from math import sqrt, isnan
from statistics import mean, median, pstdev
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="ClinAI Intelligence Engine", version="1.0.0")


def finite(x: float) -> float:
    if not isinstance(x, (int, float)) or isnan(float(x)):
        raise ValueError("A finite numeric value is required")
    return float(x)


def round_value(x: float, digits: int = 4) -> float:
    return round(float(x), digits)


def parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def linear_regression(values: list[float]) -> dict[str, float]:
    n = len(values)
    if n < 2:
        raise ValueError("At least two observations are required")
    xs = list(range(n))
    mx, my = mean(xs), mean(values)
    denom = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, values)) / denom
    intercept = my - slope * mx
    predicted = [intercept + slope * x for x in xs]
    ss_res = sum((y - p) ** 2 for y, p in zip(values, predicted))
    ss_tot = sum((y - my) ** 2 for y in values)
    r2 = 1 - ss_res / ss_tot if ss_tot else 1.0
    return {"slope": slope, "intercept": intercept, "r2": r2}


def calculate(operation: str, inputs: dict[str, Any]) -> dict[str, Any]:
    op = operation.lower().strip()

    if op == "bmi":
        weight = finite(inputs["weightKg"])
        height_cm = finite(inputs["heightCm"])
        height_m = height_cm / 100
        if height_m <= 0:
            raise ValueError("Height must be greater than zero")
        return {"operation": op, "value": round_value(weight / (height_m ** 2)), "unit": "kg/m²", "formula": "weightKg / heightM²"}

    if op == "bsa_mosteller":
        weight = finite(inputs["weightKg"])
        height = finite(inputs["heightCm"])
        if weight <= 0 or height <= 0:
            raise ValueError("Weight and height must be greater than zero")
        return {"operation": op, "value": round_value(sqrt((height * weight) / 3600)), "unit": "m²", "formula": "sqrt(heightCm × weightKg / 3600)"}

    if op == "mean_arterial_pressure":
        systolic = finite(inputs["systolic"])
        diastolic = finite(inputs["diastolic"])
        return {"operation": op, "value": round_value((systolic + 2 * diastolic) / 3), "unit": "mmHg", "formula": "(SBP + 2×DBP) / 3"}

    if op == "pulse_pressure":
        systolic, diastolic = finite(inputs["systolic"]), finite(inputs["diastolic"])
        return {"operation": op, "value": round_value(systolic - diastolic), "unit": "mmHg", "formula": "SBP − DBP"}

    if op == "shock_index":
        hr, systolic = finite(inputs["heartRate"]), finite(inputs["systolic"])
        if systolic <= 0:
            raise ValueError("Systolic pressure must be greater than zero")
        return {"operation": op, "value": round_value(hr / systolic), "unit": "ratio", "formula": "heartRate / SBP"}

    if op == "anion_gap":
        sodium, chloride, bicarbonate = finite(inputs["sodium"]), finite(inputs["chloride"]), finite(inputs["bicarbonate"])
        return {"operation": op, "value": round_value(sodium - chloride - bicarbonate), "unit": "mEq/L", "formula": "Na − Cl − HCO₃"}

    if op == "anion_gap_with_potassium":
        sodium, potassium = finite(inputs["sodium"]), finite(inputs["potassium"])
        chloride, bicarbonate = finite(inputs["chloride"]), finite(inputs["bicarbonate"])
        return {"operation": op, "value": round_value(sodium + potassium - chloride - bicarbonate), "unit": "mEq/L", "formula": "Na + K − Cl − HCO₃"}

    if op == "corrected_calcium":
        calcium, albumin = finite(inputs["calciumMgDl"]), finite(inputs["albuminGDl"])
        return {"operation": op, "value": round_value(calcium + 0.8 * (4.0 - albumin)), "unit": "mg/dL", "formula": "Ca + 0.8×(4.0−albumin)"}

    if op == "corrected_sodium":
        sodium, glucose = finite(inputs["sodium"]), finite(inputs["glucoseMgDl"])
        correction = 1.6 * ((glucose - 100) / 100)
        return {"operation": op, "value": round_value(sodium + correction), "unit": "mEq/L", "formula": "Na + 1.6×((glucose−100)/100)", "note": "Formula is an estimate; local protocol may differ."}

    if op == "egfr_ckd_epi_2021":
        # CKD-EPI 2021 creatinine equation. Race-free equation.
        creatinine = finite(inputs["creatinineMgDl"])
        age = finite(inputs["ageYears"])
        sex = str(inputs.get("sex", "unknown")).lower()
        if creatinine <= 0 or age <= 0:
            raise ValueError("Creatinine and age must be greater than zero")
        k = 0.7 if sex == "female" else 0.9
        alpha = -0.241 if sex == "female" else -0.302
        sex_factor = 1.012 if sex == "female" else 1.0
        value = 142 * min(creatinine / k, 1) ** alpha * max(creatinine / k, 1) ** -1.200 * (0.9938 ** age) * sex_factor
        return {"operation": op, "value": round_value(value, 1), "unit": "mL/min/1.73m²", "formula": "CKD-EPI 2021 creatinine equation", "note": "Use local clinical laboratory guidance and clinician review."}

    if op == "cockcroft_gault":
        age, weight, creatinine = finite(inputs["ageYears"]), finite(inputs["weightKg"]), finite(inputs["creatinineMgDl"])
        sex = str(inputs.get("sex", "unknown")).lower()
        if age <= 0 or weight <= 0 or creatinine <= 0:
            raise ValueError("Age, weight and creatinine must be greater than zero")
        value = ((140 - age) * weight) / (72 * creatinine)
        if sex == "female":
            value *= 0.85
        return {"operation": op, "value": round_value(value, 1), "unit": "mL/min", "formula": "Cockcroft-Gault", "note": "Weight selection and clinical interpretation require professional review."}

    if op == "percentage":
        numerator, denominator = finite(inputs["numerator"]), finite(inputs["denominator"])
        if denominator == 0:
            raise ValueError("Denominator cannot be zero")
        return {"operation": op, "value": round_value((numerator / denominator) * 100), "unit": "%", "formula": "numerator / denominator × 100"}

    if op == "percent_change":
        previous, current = finite(inputs["previous"]), finite(inputs["current"])
        if previous == 0:
            raise ValueError("Previous value cannot be zero")
        return {"operation": op, "value": round_value(((current - previous) / abs(previous)) * 100), "unit": "%", "formula": "(current−previous) / |previous| × 100"}

    if op == "rate_per_1000":
        events, population = finite(inputs["events"]), finite(inputs["population"])
        if population <= 0:
            raise ValueError("Population must be greater than zero")
        return {"operation": op, "value": round_value((events / population) * 1000), "unit": "per 1,000", "formula": "events / population × 1,000"}

    if op == "collection_rate":
        billed, paid = finite(inputs["billed"]), finite(inputs["paid"])
        if billed <= 0:
            raise ValueError("Billed amount must be greater than zero")
        return {"operation": op, "value": round_value((paid / billed) * 100), "unit": "%", "formula": "paid / billed × 100"}

    if op == "occupancy_rate":
        occupied, capacity = finite(inputs["occupied"]), finite(inputs["capacity"])
        if capacity <= 0:
            raise ValueError("Capacity must be greater than zero")
        return {"operation": op, "value": round_value((occupied / capacity) * 100), "unit": "%", "formula": "occupied / capacity × 100"}

    if op == "age_years":
        dob = parse_date(inputs["dateOfBirth"])
        at = parse_date(inputs.get("at", datetime.now().isoformat()))
        years = at.year - dob.year - ((at.month, at.day) < (dob.month, dob.day))
        return {"operation": op, "value": years, "unit": "years", "asOf": at.isoformat()}

    if op == "gestational_age":
        lmp = parse_date(inputs["lmp"])
        at = parse_date(inputs.get("at", datetime.now().isoformat()))
        days = max(0, (at.date() - lmp.date()).days)
        return {"operation": op, "weeks": days // 7, "days": days % 7, "totalDays": days, "unit": "weeks+days"}

    if op == "estimated_due_date":
        lmp = parse_date(inputs["lmp"])
        edd = lmp + timedelta(days=280)
        return {"operation": op, "value": edd.date().isoformat(), "method": "LMP + 280 days", "note": "Clinical dating may use other information and should follow local protocol."}

    if op == "statistics":
        values = [finite(v) for v in inputs["values"]]
        if not values:
            raise ValueError("At least one value is required")
        sd = pstdev(values) if len(values) > 1 else 0.0
        return {"operation": op, "count": len(values), "sum": round_value(sum(values)), "mean": round_value(mean(values)), "median": round_value(median(values)), "min": min(values), "max": max(values), "stdDev": round_value(sd), "p25": round_value(sorted(values)[max(0, int(0.25*(len(values)-1)))]), "p75": round_value(sorted(values)[min(len(values)-1, int(0.75*(len(values)-1)))])}

    if op == "trend":
        values = [finite(v) for v in inputs["values"]]
        reg = linear_regression(values)
        return {"operation": op, "statistics": calculate("statistics", {"values": values}), "trend": {"slope": round_value(reg["slope"]), "r2": round_value(reg["r2"]), "direction": "increasing" if reg["slope"] > 0 else "decreasing" if reg["slope"] < 0 else "flat"}}

    if op == "forecast_linear":
        values = [finite(v) for v in inputs["values"]]
        horizon = int(inputs.get("horizon", 1))
        if horizon < 1 or horizon > 365:
            raise ValueError("Horizon must be between 1 and 365")
        reg = linear_regression(values)
        start = len(values)
        forecasts = [round_value(reg["intercept"] + reg["slope"] * (start + i)) for i in range(horizon)]
        return {"operation": op, "forecasts": forecasts, "model": "linear regression", "r2": round_value(reg["r2"]), "slope": round_value(reg["slope"])}

    if op == "zscore_anomalies":
        values = [finite(v) for v in inputs["values"]]
        threshold = float(inputs.get("threshold", 2.5))
        if len(values) < 2:
            raise ValueError("At least two values are required")
        m, sd = mean(values), pstdev(values)
        if sd == 0:
            scores = [0.0 for _ in values]
        else:
            scores = [(v - m) / sd for v in values]
        return {"operation": op, "mean": round_value(m), "stdDev": round_value(sd), "threshold": threshold, "scores": [round_value(x) for x in scores], "anomalyIndexes": [i for i, x in enumerate(scores) if abs(x) >= threshold]}

    if op == "waiting_time_minutes":
        joined = parse_date(inputs["joinedAt"])
        called = parse_date(inputs["calledAt"])
        return {"operation": op, "value": round_value(max(0, (called - joined).total_seconds() / 60), 1), "unit": "minutes"}

    if op == "stock_days":
        quantity, daily_use = finite(inputs["quantity"]), finite(inputs["dailyUse"])
        if daily_use <= 0:
            return {"operation": op, "value": None, "unit": "days", "note": "Daily use is zero or unavailable."}
        return {"operation": op, "value": round_value(quantity / daily_use, 1), "unit": "days"}

    raise ValueError(f"Unsupported operation: {operation}")


def _require_nonempty(values: list[float]) -> list[float]:
    cleaned = [finite(v) for v in values]
    if not cleaned:
        raise ValueError("At least one value is required")
    return cleaned


def advanced_calculate(operation: str, inputs: dict[str, Any]) -> dict[str, Any]:
    """Additional deterministic operations for multi-problem healthcare analytics."""
    op = operation.lower().strip()

    if op == "delta":
        previous, current = finite(inputs["previous"]), finite(inputs["current"])
        return {"operation": op, "absoluteChange": round_value(current - previous), "direction": "increasing" if current > previous else "decreasing" if current < previous else "unchanged"}

    if op == "rolling_mean":
        values = _require_nonempty(inputs["values"])
        window = int(inputs.get("window", 3))
        if window < 1 or window > len(values):
            raise ValueError("Window must be between 1 and the number of values")
        means = [round_value(mean(values[i-window+1:i+1])) for i in range(window-1, len(values))]
        return {"operation": op, "window": window, "values": means}

    if op == "ewma":
        values = _require_nonempty(inputs["values"])
        alpha = float(inputs.get("alpha", 0.3))
        if not 0 < alpha <= 1:
            raise ValueError("Alpha must be greater than 0 and no greater than 1")
        out = [values[0]]
        for value in values[1:]:
            out.append(alpha * value + (1 - alpha) * out[-1])
        return {"operation": op, "alpha": alpha, "values": [round_value(x) for x in out], "latest": round_value(out[-1])}

    if op == "reference_range_flags":
        value = finite(inputs["value"])
        low = inputs.get("low")
        high = inputs.get("high")
        if low is None and high is None:
            raise ValueError("At least one reference boundary is required")
        low_n = finite(low) if low is not None else None
        high_n = finite(high) if high is not None else None
        if low_n is not None and high_n is not None and low_n > high_n:
            raise ValueError("Low reference boundary cannot exceed high boundary")
        status = "within-range"
        if low_n is not None and value < low_n: status = "below-range"
        if high_n is not None and value > high_n: status = "above-range"
        return {"operation": op, "value": value, "low": low_n, "high": high_n, "status": status}

    if op == "fluid_balance":
        intake = sum(_require_nonempty(inputs["intakeMl"]))
        output = sum(_require_nonempty(inputs["outputMl"]))
        return {"operation": op, "intakeMl": round_value(intake, 1), "outputMl": round_value(output, 1), "netMl": round_value(intake-output, 1)}

    if op == "urine_output_rate":
        urine_ml = finite(inputs["urineMl"])
        weight_kg = finite(inputs["weightKg"])
        hours = finite(inputs["hours"])
        if weight_kg <= 0 or hours <= 0: raise ValueError("Weight and hours must be greater than zero")
        return {"operation": op, "value": round_value(urine_ml/(weight_kg*hours), 3), "unit": "mL/kg/hour"}

    if op == "time_to_event_minutes":
        start = parse_date(inputs["startAt"])
        end = parse_date(inputs["endAt"])
        return {"operation": op, "value": round_value(max(0, (end-start).total_seconds()/60), 1), "unit": "minutes"}

    if op == "coefficient_of_variation":
        values = _require_nonempty(inputs["values"])
        m = mean(values)
        if m == 0: raise ValueError("Mean cannot be zero for coefficient of variation")
        return {"operation": op, "value": round_value((pstdev(values)/abs(m))*100), "unit": "%"}

    if op == "correlation":
        a = _require_nonempty(inputs["firstValues"])
        b = _require_nonempty(inputs["secondValues"])
        if len(a) != len(b) or len(a) < 2: raise ValueError("Two equal-length series with at least two values are required")
        ma, mb = mean(a), mean(b)
        da, db = [x-ma for x in a], [x-mb for x in b]
        denom = sqrt(sum(x*x for x in da) * sum(x*x for x in db))
        if denom == 0: raise ValueError("Correlation is undefined for a constant series")
        r = sum(x*y for x,y in zip(da,db))/denom
        return {"operation": op, "correlation": round_value(r), "interpretation": "positive" if r > 0 else "negative" if r < 0 else "none"}

    if op == "batch":
        operations = inputs.get("operations")
        if not isinstance(operations, list) or not operations:
            raise ValueError("operations must be a non-empty list")
        results = []
        for item in operations[:50]:
            if not isinstance(item, dict) or "operation" not in item:
                raise ValueError("Each batch item needs an operation")
            results.append(advanced_calculate(str(item["operation"]), dict(item.get("inputs") or {})) if str(item["operation"]).lower() not in {"bmi","bsa_mosteller","mean_arterial_pressure","pulse_pressure","shock_index","anion_gap","anion_gap_with_potassium","corrected_calcium","corrected_sodium","egfr_ckd_epi_2021","cockcroft_gault","percentage","percent_change","rate_per_1000","collection_rate","occupancy_rate","age_years","gestational_age","estimated_due_date","statistics","trend","forecast_linear","zscore_anomalies","waiting_time_minutes","stock_days"} else calculate(str(item["operation"]), dict(item.get("inputs") or {})))
        return {"operation": op, "count": len(results), "results": results}

    raise ValueError(f"Unsupported operation: {operation}")


class ComputeRequest(BaseModel):
    operation: str = Field(min_length=2)
    inputs: dict[str, Any] = Field(default_factory=dict)


class DatasetRequest(BaseModel):
    operation: Literal["describe", "trend", "forecast", "anomalies", "compare", "rolling", "ewma", "correlation"]
    values: list[float] = Field(min_length=1)
    second_values: list[float] | None = None
    horizon: int = 1
    threshold: float = 2.5


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "clinai-intelligence-engine", "version": "1.0.0"}


@app.post("/v1/compute")
def compute(request: ComputeRequest) -> dict[str, Any]:
    try:
        try:
            result = calculate(request.operation, request.inputs)
        except ValueError as exc:
            if str(exc).startswith("Unsupported operation:"):
                result = advanced_calculate(request.operation, request.inputs)
            else:
                raise
        return {"ok": True, "result": result}
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/dataset")
def dataset(request: DatasetRequest) -> dict[str, Any]:
    try:
        if request.operation == "describe":
            return {"ok": True, "result": calculate("statistics", {"values": request.values})}
        if request.operation == "trend":
            return {"ok": True, "result": calculate("trend", {"values": request.values})}
        if request.operation == "forecast":
            return {"ok": True, "result": calculate("forecast_linear", {"values": request.values, "horizon": request.horizon})}
        if request.operation == "anomalies":
            return {"ok": True, "result": calculate("zscore_anomalies", {"values": request.values, "threshold": request.threshold})}
        if request.operation == "compare":
            if not request.second_values:
                raise ValueError("second_values is required for comparison")
            a = calculate("statistics", {"values": request.values})
            b = calculate("statistics", {"values": request.second_values})
            return {"ok": True, "result": {"first": a, "second": b, "meanChangePercent": calculate("percent_change", {"previous": a["mean"], "current": b["mean"]})["value"]}}
        if request.operation == "rolling":
            return {"ok": True, "result": advanced_calculate("rolling_mean", {"values": request.values, "window": request.horizon})}
        if request.operation == "ewma":
            return {"ok": True, "result": advanced_calculate("ewma", {"values": request.values, "alpha": request.threshold})}
        if request.operation == "correlation":
            if not request.second_values: raise ValueError("second_values is required for correlation")
            return {"ok": True, "result": advanced_calculate("correlation", {"firstValues": request.values, "secondValues": request.second_values})}
        raise ValueError("Unsupported dataset operation")
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ScreenRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


@app.post("/v1/screen")
def screen(request: ScreenRequest) -> dict[str, Any]:
    """Non-diagnostic data-quality/clinical-review screen using supplied boundaries."""
    values = request.values
    flags: list[dict[str, Any]] = []
    for name, item in list(values.items())[:100]:
        if isinstance(item, dict) and "value" in item and ("low" in item or "high" in item):
            try:
                result = advanced_calculate("reference_range_flags", item)
                if result["status"] != "within-range":
                    flags.append({"field": name, **result})
            except (KeyError, ValueError, TypeError):
                flags.append({"field": name, "status": "needs-review", "reason": "Reference range could not be evaluated."})
    return {"ok": True, "result": {"flags": flags, "flagCount": len(flags), "note": "Flags are screening signals only; confirm against the applicable clinical context and local protocol."}}
