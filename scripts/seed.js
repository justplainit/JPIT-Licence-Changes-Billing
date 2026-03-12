const { PrismaClient } = require("../src/generated/prisma");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: "admin@jpit.co.za" },
  });

  if (existing) {
    console.log("Admin user already exists, skipping seed.");
    return;
  }

  const passwordHash = await bcrypt.hash("Admin@2026!", 10);

  const user = await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@jpit.co.za",
      passwordHash,
      role: "ADMIN",
    },
  });

  console.log(`Created admin user: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
