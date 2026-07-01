import { ObjectId } from "mongodb";
import { getUsersCollection } from "@/lib/db/collections";
import type { UserDocument } from "@/lib/db/types";
import type { OnboardingStepId } from "@/lib/onboarding";
import {
  normalizeUserPreferences,
  type LoaderColorId,
  type LoaderStyleId,
  type ThemeMode,
  type UserPreferences,
} from "@/lib/user-preferences";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserById(userId: string): Promise<UserDocument | null> {
  const usersCollection = await getUsersCollection();
  return usersCollection.findOne({ _id: userId });
}

export async function findUserByEmail(
  email: string,
): Promise<UserDocument | null> {
  const usersCollection = await getUsersCollection();
  return usersCollection.findOne({ emailNormalized: normalizeEmail(email) });
}

export async function updateUserPreferences(input: {
  userId: string;
  loaderColor?: LoaderColorId;
  loaderStyle?: LoaderStyleId;
  loaderCustomColor?: string;
  themeMode?: ThemeMode;
}): Promise<UserPreferences> {
  const usersCollection = await getUsersCollection();
  const now = new Date();
  const $set: Record<string, unknown> = {
    updatedAt: now,
  };

  if (input.loaderColor) {
    $set["preferences.loaderColor"] = input.loaderColor;
  }

  if (input.loaderStyle) {
    $set["preferences.loaderStyle"] = input.loaderStyle;
  }

  if (input.loaderCustomColor) {
    $set["preferences.loaderCustomColor"] = input.loaderCustomColor;
  }

  if (input.themeMode) {
    $set["preferences.themeMode"] = input.themeMode;
  }

  await usersCollection.updateOne(
    { _id: input.userId },
    { $set },
  );

  const user = await usersCollection.findOne(
    { _id: input.userId },
    { projection: { preferences: 1 } },
  );

  return normalizeUserPreferences(user?.preferences);
}

export async function updateUserContext(input: {
  userId: string;
  userContext: string | null;
}): Promise<void> {
  const usersCollection = await getUsersCollection();
  await usersCollection.updateOne(
    { _id: input.userId },
    {
      $set: {
        userContext: input.userContext,
        updatedAt: new Date(),
      },
    },
  );
}

export async function updateUserProfile(input: {
  userId: string;
  displayName: string;
  email?: string;
  profileRole?: string | null;
}): Promise<UserDocument | null> {
  const usersCollection = await getUsersCollection();
  const now = new Date();
  const $set: Record<string, unknown> = {
    displayName: input.displayName.trim(),
    profileRole: input.profileRole?.trim() || null,
    updatedAt: now,
  };

  if (input.email) {
    const email = input.email.trim();
    $set.email = email;
    $set.emailNormalized = normalizeEmail(email);
  }

  await usersCollection.updateOne(
    { _id: input.userId },
    { $set },
  );

  return usersCollection.findOne({ _id: input.userId });
}

export async function updateUserOnboarding(input: {
  userId: string;
  step?: OnboardingStepId;
  completed?: boolean;
}): Promise<void> {
  const usersCollection = await getUsersCollection();
  const now = new Date();
  const $set: Record<string, unknown> = {
    updatedAt: now,
  };

  if (input.step) {
    $set.onboardingStep = input.step;
  }

  if (input.completed) {
    $set.onboardingStep = "start";
    $set.onboardingCompletedAt = now;
  }

  await usersCollection.updateOne(
    { _id: input.userId },
    { $set },
  );
}

export async function upsertUserByEmail(input: {
  email: string;
  displayName: string;
  profileRole?: string | null;
}): Promise<UserDocument> {
  const usersCollection = await getUsersCollection();
  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  const displayName = input.displayName.trim();
  const profileRole = input.profileRole?.trim() || null;
  const now = new Date();

  await usersCollection.updateOne(
    { emailNormalized },
    {
      $set: {
        email,
        emailNormalized,
        displayName,
        profileRole,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        onboardingStep: "identity",
        onboardingCompletedAt: null,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const user = await usersCollection.findOne({ emailNormalized });

  if (!user) {
    throw new Error("[db] Failed to upsert user by email.");
  }

  return user;
}
