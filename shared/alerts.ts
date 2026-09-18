export function meetsDelayAlertThreshold(
  delayMinutes: number,
  thresholdMinutes: number,
) {
  return delayMinutes >= thresholdMinutes;
}
