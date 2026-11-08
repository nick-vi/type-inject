// Arrow function with return type annotation only (no variable annotation)
// - should be extracted via the return type fallback
export const scale = (n: number): number => n * 2;

// Untyped arrow function without a return annotation
// - should NOT be extracted
export const add = (a: number, b: number) => a + b;
