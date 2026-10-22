export const cartKeys = {
  all: ["cart"] as const,
  item: (id: number) => [...cartKeys.all, "item", id] as const,
};
