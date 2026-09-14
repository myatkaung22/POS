import { PrismaClient } from "@prisma/client";
import { replaceKitchenMenu } from "./kitchen-menu.ts";

const prisma = new PrismaClient();

async function main() {
  await replaceKitchenMenu(prisma);
  const cats = await prisma.category.count();
  const items = await prisma.menuItem.count();
  console.log(`Imported 4 Corner kitchen menu · ${cats} categories · ${items} items`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
