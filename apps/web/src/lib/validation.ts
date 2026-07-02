const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateDisplayName(value: FormDataEntryValue | null): string | null {
  const displayName = readString(value);

  if (displayName.length < 2 || displayName.length > 80) {
    return null;
  }

  return displayName;
}

export function validateEmail(value: FormDataEntryValue | null): string | null {
  const email = readString(value);

  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return email;
}

export function validateWorkspaceName(
  value: FormDataEntryValue | null,
): string | null {
  const workspaceName = readString(value);

  if (workspaceName.length < 2 || workspaceName.length > 80) {
    return null;
  }

  return workspaceName;
}

export function validateOptionalProfileRole(
  value: FormDataEntryValue | null,
): string | null {
  const role = readString(value);

  if (!role) {
    return null;
  }

  if (role.length > 80) {
    return null;
  }

  return role;
}

export function validateProfileRole(value: FormDataEntryValue | null): string | null {
  const role = readString(value);

  if (role.length < 2 || role.length > 80) {
    return null;
  }

  return role;
}

export function validateAppName(value: FormDataEntryValue | null): string | null {
  const appName = readString(value);

  if (appName.length < 2 || appName.length > 80) {
    return null;
  }

  return appName;
}
