import type { Category } from "@/types/catalog";

/**
 * Client-side helpers for the category tree.
 *
 * The server sends `tree`, `parentId`, `depth` and rolled-up counts; these
 * helpers exist so the UI never re-implements the tree rules and still works
 * with a hierarchy-less response (every category becomes a root).
 */

export interface CategoryOption {
  id: number;
  name: string;
  depth: number;
}

export function buildChildrenMap(categories: Category[]): Map<number | null, Category[]> {
  const map = new Map<number | null, Category[]>();
  for (const category of categories) {
    const parentId = category.parentId ?? null;
    const bucket = map.get(parentId) ?? [];
    bucket.push(category);
    map.set(parentId, bucket);
  }
  // Input order is preserved: the API already returns name-sorted rows, so each
  // level stays alphabetical without re-sorting (and fixtures keep their order).
  return map;
}

/** Pre-order traversal: roots first, each immediately followed by its children. */
export function flattenTree(categories: Category[]): Category[] {
  const children = buildChildrenMap(categories);
  const seen = new Set<number>();
  const ordered: Category[] = [];

  function visit(category: Category) {
    if (seen.has(category.id)) return;
    seen.add(category.id);
    ordered.push(category);
    for (const child of children.get(category.id) ?? []) visit(child);
  }

  for (const root of children.get(null) ?? []) visit(root);
  // Orphans (parent not in the payload) and cycle survivors still appear once.
  for (const category of categories) visit(category);
  return ordered;
}

export function categoryDepth(category: Category, byId: Map<number, Category>): number {
  if (typeof category.depth === "number") return category.depth;

  let depth = 1;
  let current = category;
  const seen = new Set([category.id]);
  while (current.parentId !== null && current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth += 1;
    current = parent;
  }
  return depth;
}

export function descendantIds(categories: Category[], rootId: number): Set<number> {
  const children = buildChildrenMap(categories);
  const found = new Set<number>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as number;
    for (const child of children.get(id) ?? []) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      stack.push(child.id);
    }
  }
  return found;
}

/**
 * Options for a parent select: every category except the edited one and its
 * descendants (which would create a cycle). Indented by depth.
 */
export function parentCategoryOptions(
  categories: Category[],
  excludeId?: number,
): CategoryOption[] {
  const excluded = new Set<number>();
  if (excludeId !== undefined) {
    excluded.add(excludeId);
    for (const id of descendantIds(categories, excludeId)) excluded.add(id);
  }

  const byId = new Map(categories.map((category) => [category.id, category]));
  return flattenTree(categories)
    .filter((category) => !excluded.has(category.id))
    .map((category) => ({
      id: category.id,
      name: category.name,
      depth: categoryDepth(category, byId),
    }));
}

/** Root → node ancestor chain, used for breadcrumbs. Empty when unknown. */
export function categoryPath(categories: Category[], value: string | number): Category[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const start =
    typeof value === "number"
      ? byId.get(value)
      : categories.find(
          (category) => category.slug === value || String(category.id) === String(value),
        );
  if (!start) return [];

  const path = [start];
  const seen = new Set([start.id]);
  let current = start;
  while (current.parentId !== null && current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    path.unshift(parent);
    current = parent;
  }
  return path;
}
