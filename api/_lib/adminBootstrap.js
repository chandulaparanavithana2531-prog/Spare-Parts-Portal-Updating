export function canResetExistingAdminPassword(user, identifier) {
  return identifier.trim().toLowerCase() === 'admin' &&
    user?.role === 'admin' &&
    user.adminPasswordResetUsed !== true;
}