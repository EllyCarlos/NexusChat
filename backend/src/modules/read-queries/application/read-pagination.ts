export const calculateReadSkip = (page: number, limit: number): number => (
  Math.ceil((page - 1) * limit)
);
