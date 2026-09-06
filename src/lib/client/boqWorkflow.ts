export function applyCreatedBoq<T extends { id: string }>(
  current: T[],
  created: T,
) {
  return {
    boqs: current.some((row) => row.id === created.id)
      ? current
      : [created, ...current],
    selectedBoqId: created.id,
  };
}
