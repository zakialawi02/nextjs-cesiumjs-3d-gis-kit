import "../src/server/load-env";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Create the initial admin and engineering accounts.
 *
 * Does nothing once any account exists (including soft-deleted ones), so re-running the seed for the
 * category data never resets changed passwords or re-creates accounts. Change these default passwords
 * after the first login on any shared or deployed instance.
 */
async function seedUsers() {
  if ((await prisma.user.count()) > 0) {
    console.log("Users already exist; skipping initial account creation.");
    return;
  }

  const accounts = [
    {
      name: "Admin User",
      username: "admin",
      email: "admin@mail.com",
      password: "admin",
      role: "admin",
      profile_photo_path: "/assets/img/profile/admin.png",
    },
    {
      name: "Engineering User",
      username: "engineering",
      email: "engineering@mail.com",
      password: "engineering",
      role: "engineering",
      profile_photo_path: "/assets/img/profile/user.png",
    },
  ];

  for (const account of accounts) {
    await prisma.user.create({
      data: {
        ...account,
        password: await bcrypt.hash(account.password, 12),
        email_verified_at: new Date(),
      },
    });
  }
  console.log("Created users: admin / admin, engineering / engineering");
}

/**
 * Seed the default layer categories. "Other" is the protected fallback for uncategorized uploads.
 */
async function seedLayerCategories() {
  const categories = [
    { name: "Terrain & Orthophoto", slug: "terrain-orthophoto", color: "#0ea5e9", sort_order: 1 },
    { name: "Design", slug: "design", color: "#f59e0b", sort_order: 2 },
    { name: "Boundary", slug: "boundary", color: "#10b981", sort_order: 3 },
    { name: "Other", slug: "other", color: "#6b7280", sort_order: 999 },
  ];

  for (const category of categories) {
    await prisma.layerCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }
}

async function main() {
  await seedUsers();
  await seedLayerCategories();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
