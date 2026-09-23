export type SrsState = {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
};

export type ReviewQuality = "again" | "good" | "easy";

const MIN_EASE_FACTOR = 1.3;

/**
 * SM-2簡易版。3段階評価（again/good/easy）で次回復習日を決める。
 * again: 間隔をリセットして翌日に再出題。good/easy: 間隔をease factorで伸ばす。
 */
export function computeNextReview(
  state: SrsState,
  quality: ReviewQuality
): SrsState & { nextReviewAt: Date } {
  let { easeFactor, intervalDays, repetitions } = state;

  if (quality === "again") {
    repetitions = 0;
    intervalDays = 1;
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2);
  } else {
    repetitions += 1;
    easeFactor =
      quality === "easy"
        ? easeFactor + 0.15
        : Math.max(MIN_EASE_FACTOR, easeFactor - 0.02);

    if (repetitions === 1) {
      intervalDays = quality === "easy" ? 3 : 1;
    } else if (repetitions === 2) {
      intervalDays = quality === "easy" ? 8 : 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
  }

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

  return { easeFactor, intervalDays, repetitions, nextReviewAt };
}
