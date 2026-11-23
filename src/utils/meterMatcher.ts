import type { PhotoKind, SettlementInputs } from '../types/billing';

export type MeterPhotoKind = 'meter201' | 'meter202' | 'meterTot';

export interface PrevBaselines {
  prevTotal: number;
  prev201: number;
  prev202: number;
}

export interface MeterCandidate {
  meterValue: number | null;
  meterDigitCount: number | null;
}

export interface InferredSlotResult {
  targetKind: PhotoKind;
  wasRerouted: boolean;
  reason: string | null;
}

export interface SwappedMetersSuggestion {
  mapping: Record<MeterPhotoKind, MeterPhotoKind>;
  suggested: {
    curr201: string;
    curr202: string;
    currTotal: string;
  };
  summaryText: string;
}

const METER_SLOTS: MeterPhotoKind[] = ['meter201', 'meter202', 'meterTot'];

export const PHOTO_KIND_KOREAN_LABEL: Record<PhotoKind, string> = {
  meter201: '201호 계량기',
  meter202: '202호 계량기',
  meterTot: '건물 전체 계량기',
  bill: '수도세 고지서',
};

function getPrevForSlot(slot: MeterPhotoKind, prev: PrevBaselines): number {
  if (slot === 'meter201') return prev.prev201;
  if (slot === 'meter202') return prev.prev202;
  return prev.prevTotal;
}

/**
 * Scores how plausible a detected meter reading + drum digit count is for a specific slot.
 * Higher score = stronger match. Positive scores (> 20) indicate a plausible match;
 * negative scores indicate an implausible match.
 */
export function scoreMeterSlot(
  value: number | null,
  digitCount: number | null,
  slot: MeterPhotoKind,
  prev: PrevBaselines
): number {
  let score = 0;

  // 1. Physical drum count signal: main building meter has 5 digits ("만 천 백 십 일"),
  // while 201호 & 202호 sub-meters have 4 digits ("천 백 십 일").
  if (digitCount === 5) {
    score += slot === 'meterTot' ? 85 : -75;
  } else if (digitCount === 4) {
    score += slot === 'meterTot' ? -45 : 25;
  }

  if (value === null || !Number.isFinite(value)) {
    return score;
  }

  const prevVal = getPrevForSlot(slot, prev);
  if (!Number.isFinite(prevVal) || prevVal < 0) {
    return score;
  }

  const diff = value - prevVal;

  // 2. Reading progression signal (normal monthly usage is 0..150 m3)
  if (diff >= 0 && diff <= 80) {
    score += 120 - diff * 0.25;
  } else if (diff > 80 && diff <= 180) {
    score += 75 - (diff - 80) * 0.35;
  } else if (diff >= -3 && diff < 0) {
    // Minor 1-3 m3 typo/re-read tolerance
    score += 35;
  } else if (slot === 'meterTot' && prevVal >= 500 && value >= 0 && value <= 250) {
    // Brand-new main meter replacement starting near 0
    score += digitCount === 5 ? 35 : -10;
  } else if (diff < -3) {
    score -= Math.min(140, 75 + Math.abs(diff) * 0.12);
  } else {
    // diff > 180: way too large for a single month
    score -= Math.min(130, 50 + (diff - 180) * 0.12);
  }

  return score;
}

/**
 * Infers the most likely target slot for a single analyzed photo.
 * - Always routes bills -> 'bill' and meters -> meter slot.
 * - For meters uploaded to a specific slot, only reroutes when the chosen slot is
 *   clearly implausible AND another slot is unambiguously plausible.
 */
export function inferBestPhotoSlot(
  detectedType: 'meter' | 'bill',
  meterValue: number | null,
  meterDigitCount: number | null,
  requestedKind: PhotoKind | 'auto',
  prev: PrevBaselines
): InferredSlotResult {
  if (detectedType === 'bill') {
    const wasRerouted = requestedKind !== 'bill' && requestedKind !== 'auto';
    return {
      targetKind: 'bill',
      wasRerouted,
      reason: wasRerouted
        ? '고지서 사진이라 수도세 고지서 칸으로 자동 이동했어요'
        : null,
    };
  }

  const scored = METER_SLOTS.map((slot) => ({
    slot,
    score: scoreMeterSlot(meterValue, meterDigitCount, slot, prev),
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  // If uploaded via bulk 'auto' or mistakenly into the 'bill' slot, pick the highest-scoring meter slot
  if (requestedKind === 'auto' || requestedKind === 'bill') {
    const wasRerouted = requestedKind === 'bill';
    return {
      targetKind: best.slot,
      wasRerouted,
      reason: wasRerouted
        ? `${PHOTO_KIND_KOREAN_LABEL[best.slot]} 사진이라 자동으로 제자리에 넣었어요`
        : null,
    };
  }

  const chosenScore =
    scored.find((s) => s.slot === requestedKind)?.score ?? -999;

  // Stay in chosen slot if it's already best or clearly plausible
  if (best.slot === requestedKind || chosenScore >= 40) {
    return {
      targetKind: requestedKind,
      wasRerouted: false,
      reason: null,
    };
  }

  // Reroute only when best slot is clearly plausible and decisively beats chosen & runner-up
  const beatsChosenBy = best.score - chosenScore;
  const beatsSecondBy = best.score - second.score;
  if (best.score >= 45 && beatsChosenBy >= 60 && beatsSecondBy >= 25) {
    return {
      targetKind: best.slot,
      wasRerouted: true,
      reason: `${PHOTO_KIND_KOREAN_LABEL[best.slot]} 사진으로 판단해 자동으로 제자리에 넣었어요`,
    };
  }

  return {
    targetKind: requestedKind,
    wasRerouted: false,
    reason: null,
  };
}

/**
 * Conflict-free global assignment for bulk multi-photo upload (up to 4 photos in any order).
 * Assigns bills to 'bill' and finds the highest-scoring 1-to-1 assignment for meter photos.
 */
export function assignBulkPhotosToSlots<
  T extends {
    detectedType: 'meter' | 'bill';
    meterValue: number | null;
    meterDigitCount: number | null;
  },
>(items: T[], prev: PrevBaselines): Array<{ item: T; targetKind: PhotoKind }> {
  const results: Array<{ item: T; targetKind: PhotoKind }> = [];
  const billItems = items.filter((i) => i.detectedType === 'bill');
  const meterItems = items.filter((i) => i.detectedType === 'meter');

  if (billItems.length > 0) {
    results.push({ item: billItems[0], targetKind: 'bill' });
  }

  if (meterItems.length === 0) {
    return results;
  }

  // Limit to at most 3 meter slots; find maximum total score across all injective assignments
  const metersToAssign = meterItems.slice(0, 3);
  let bestScore = -Infinity;
  let bestAssignment: MeterPhotoKind[] = [];

  const permute = (
    idx: number,
    used: Set<MeterPhotoKind>,
    current: MeterPhotoKind[],
    accScore: number
  ) => {
    if (idx === metersToAssign.length) {
      if (accScore > bestScore) {
        bestScore = accScore;
        bestAssignment = [...current];
      }
      return;
    }
    const cand = metersToAssign[idx];
    for (const slot of METER_SLOTS) {
      if (used.has(slot)) continue;
      used.add(slot);
      current.push(slot);
      const s = scoreMeterSlot(cand.meterValue, cand.meterDigitCount, slot, prev);
      permute(idx + 1, used, current, accScore + s);
      current.pop();
      used.delete(slot);
    }
  };

  permute(0, new Set(), [], 0);

  metersToAssign.forEach((item, i) => {
    results.push({
      item,
      targetKind: bestAssignment[i] ?? METER_SLOTS[i],
    });
  });

  return results;
}

const ALL_METER_PERMUTATIONS: Array<Record<MeterPhotoKind, MeterPhotoKind>> = [
  { meter201: 'meter201', meter202: 'meter202', meterTot: 'meterTot' },
  { meter201: 'meter202', meter202: 'meter201', meterTot: 'meterTot' },
  { meter201: 'meterTot', meter202: 'meter202', meterTot: 'meter201' },
  { meter201: 'meter201', meter202: 'meterTot', meterTot: 'meter202' },
  // 3-way cycles (e.g. screenshots: 201←Tot, 202←201, Tot←202)
  { meter201: 'meter202', meter202: 'meterTot', meterTot: 'meter201' },
  { meter201: 'meterTot', meter202: 'meter201', meterTot: 'meter202' },
];

/**
 * Checks whether the 3 meter inputs currently entered in Step 2 appear swapped across slots.
 * `mapping[targetSlot] = sourceSlot` indicates which current slot should move into `targetSlot`.
 */
export function detectSwappedMeterInputs(
  inputs: SettlementInputs
): SwappedMetersSuggestion | null {
  if (inputs.totalMeterReplaced) return null;

  const raw: Record<MeterPhotoKind, string> = {
    meter201: inputs.curr201.trim(),
    meter202: inputs.curr202.trim(),
    meterTot: inputs.currTotal.trim(),
  };

  if (!raw.meter201 || !raw.meter202 || !raw.meterTot) return null;

  const vals: Record<MeterPhotoKind, number> = {
    meter201: Number(raw.meter201),
    meter202: Number(raw.meter202),
    meterTot: Number(raw.meterTot),
  };

  if (
    !Number.isFinite(vals.meter201) ||
    !Number.isFinite(vals.meter202) ||
    !Number.isFinite(vals.meterTot)
  ) {
    return null;
  }

  const prev: PrevBaselines = {
    prevTotal: Number(inputs.prevTotal),
    prev201: Number(inputs.prev201),
    prev202: Number(inputs.prev202),
  };

  if (
    !Number.isFinite(prev.prevTotal) ||
    !Number.isFinite(prev.prev201) ||
    !Number.isFinite(prev.prev202)
  ) {
    return null;
  }

  const billVol = Number(inputs.billUsage);

  const scorePerm = (perm: Record<MeterPhotoKind, MeterPhotoKind>): number => {
    const v201 = vals[perm.meter201];
    const v202 = vals[perm.meter202];
    const vTot = vals[perm.meterTot];

    let total =
      scoreMeterSlot(v201, null, 'meter201', prev) +
      scoreMeterSlot(v202, null, 'meter202', prev) +
      scoreMeterSlot(vTot, null, 'meterTot', prev);

    const u201 = v201 - prev.prev201;
    const u202 = v202 - prev.prev202;
    const uTot = vTot - prev.prevTotal;
    const uShop = uTot - (u201 + u202);

    if (u201 >= 0 && u202 >= 0 && uTot >= 0 && uShop >= 0) {
      total += 60;
    } else if (uShop < 0) {
      total -= 40;
    }

    if (Number.isFinite(billVol) && billVol > 0) {
      const gap = Math.abs(uTot - billVol);
      if (gap <= 15) total += 40 - gap;
    }

    return total;
  };

  const identityPerm = ALL_METER_PERMUTATIONS[0];
  const identityScore = scorePerm(identityPerm);

  let bestPerm = identityPerm;
  let bestScore = identityScore;
  let secondScore = -Infinity;

  for (const perm of ALL_METER_PERMUTATIONS) {
    const s = scorePerm(perm);
    if (s > bestScore) {
      secondScore = bestScore;
      bestScore = s;
      bestPerm = perm;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }

  // Only suggest if a non-identity permutation is overwhelmingly better & makes all 3 readings plausible
  if (bestPerm === identityPerm) return null;

  const next201 = vals[bestPerm.meter201];
  const next202 = vals[bestPerm.meter202];
  const nextTot = vals[bestPerm.meterTot];
  const d201 = next201 - prev.prev201;
  const d202 = next202 - prev.prev202;
  const dTot = nextTot - prev.prevTotal;

  const allPlausible =
    d201 >= -2 &&
    d201 <= 200 &&
    d202 >= -2 &&
    d202 <= 200 &&
    dTot >= -2 &&
    dTot <= 250;

  if (!allPlausible || bestScore - identityScore < 120 || bestScore - secondScore < 40) {
    return null;
  }

  return {
    mapping: bestPerm,
    suggested: {
      curr201: raw[bestPerm.meter201],
      curr202: raw[bestPerm.meter202],
      currTotal: raw[bestPerm.meterTot],
    },
    summaryText: `201호 ${raw[bestPerm.meter201]} · 202호 ${raw[bestPerm.meter202]} · 건물 전체 ${raw[bestPerm.meterTot]}`,
  };
}
