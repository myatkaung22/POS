export const ROLES = ["admin", "manager", "cashier", "waiter", "kitchen"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  pos: ["admin", "manager", "cashier", "waiter"],
  checkout: ["admin", "manager", "cashier"],
  discount: ["admin", "manager", "cashier"],
  kitchen: ["admin", "manager", "kitchen"],
  menu: ["admin", "manager"],
  inbox: ["admin", "manager", "cashier", "waiter"],
  reports: ["admin", "manager"],
  settings: ["admin", "manager"],
  users: ["admin"],
  tables: ["admin", "manager", "cashier", "waiter"],
  orders: ["admin", "manager", "cashier", "waiter"],
  dispatch: ["admin", "manager", "cashier", "waiter"],
  promotions: ["admin", "manager"],
  printers: ["admin", "manager"],
  clock: ["admin", "manager", "cashier", "waiter", "kitchen"],
  timesheet: ["admin", "manager"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: string, permission: Permission) {
  const allowed = PERMISSIONS[permission] as readonly string[];
  return allowed.includes(role);
}

export function assertPermission(role: string, permission: Permission) {
  if (!hasPermission(role, permission)) {
    const err = new Error("Forbidden");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}
