const { PrismaClient } = require("../src/generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const products = [
  // Microsoft 365
  { sku: "M365BB", name: "Microsoft 365 Business Basic", category: "Microsoft 365" },
  { sku: "M365BS", name: "Microsoft 365 Business Standard", category: "Microsoft 365" },
  { sku: "M365BP", name: "Microsoft 365 Business Premium", category: "Microsoft 365" },
  { sku: "M365AB", name: "Microsoft 365 Apps for Business", category: "Microsoft 365" },
  { sku: "M365AE", name: "Microsoft 365 Apps for Enterprise", category: "Microsoft 365" },
  { sku: "M365PP1", name: "Microsoft 365 Project Plan 1", category: "Microsoft 365" },
  { sku: "M365TML", name: "Microsoft 365 Tenant Management License", category: "Microsoft 365" },
  { sku: "MS365CP", name: "Microsoft 365 Copilot", category: "Microsoft 365" },
  { sku: "MS365-Tenant-Mgmt", name: "Microsoft 365 Tenant Management", category: "Microsoft 365" },
  { sku: "MS-Teams-Essentials", name: "Microsoft Teams Essentials", category: "Microsoft 365" },

  // Exchange Online
  { sku: "EOA", name: "Exchange Online Archiving", category: "Exchange Online" },
  { sku: "EOP1", name: "Exchange Online Plan 1", category: "Exchange Online" },
  { sku: "EOP2", name: "Exchange Online Plan 2", category: "Exchange Online" },
  { sku: "O365EFSR", name: "Office 365 Extra File Storage Recurring", category: "Exchange Online" },

  // Dynamics 365
  { sku: "D365-Customer-SE", name: "Dynamics 365 Customer Service Enterprise", category: "Dynamics 365" },
  { sku: "D365-Sales-EE", name: "Dynamics 365 Sales Enterprise Edition", category: "Dynamics 365" },
  { sku: "D365-Team-Members", name: "Dynamics 365 Team Members", category: "Dynamics 365" },

  // Power Platform
  { sku: "MS-Power-Apps-Premium", name: "Microsoft Power Apps Premium", category: "Power Platform" },
  { sku: "MS-POWER-BI-PRO", name: "Power BI Pro", category: "Power Platform" },

  // Project & Visio
  { sku: "MSPOP", name: "Microsoft Project Online Professional", category: "Project & Visio" },
  { sku: "VOP2-365", name: "Visio Online Plan 2", category: "Project & Visio" },

  // SharePoint & OneDrive
  { sku: "SharePoint-P1", name: "SharePoint Online (Plan 1)", category: "SharePoint & OneDrive" },
  { sku: "OneDrive-P1", name: "OneDrive for Business Plan 1", category: "SharePoint & OneDrive" },
  { sku: "OneDrive-P2", name: "OneDrive for Business Plan 2", category: "SharePoint & OneDrive" },

  // Security
  { sku: "Ironscales", name: "Ironscales Email Protect", category: "Security" },
  { sku: "Ironscales-SAT", name: "Ironscales Security Awareness Training", category: "Security" },
  { sku: "ESET", name: "ESET Endpoint Security", category: "Security" },
  { sku: "Duo-Essentials", name: "Duo Essentials", category: "Security" },
  { sku: "Server-Security-Addon", name: "Server Security Add-on (2FA Windows Sign-on)", category: "Security" },
  { sku: "Teramind-Starter", name: "Teramind Starter", category: "Security" },

  // Email & Collaboration
  { sku: "Exclaimer-Cloud", name: "Exclaimer Cloud Signature", category: "Email & Collaboration" },
  { sku: "Dropsuite-BA", name: "Dropsuite Backup & Archiving", category: "Email & Collaboration" },
  { sku: "Dropbox-Business-Monthly", name: "Dropbox for Business (Monthly)", category: "Email & Collaboration" },

  // Google Workspace
  { sku: "G-Suite-Basic", name: "Google Workspace Business Starter (Legacy G Suite Basic)", category: "Google Workspace" },
  { sku: "G-Suite-Business", name: "Google Workspace Business Standard (Legacy G Suite Business)", category: "Google Workspace" },
  { sku: "Google-Workspace-BS-Flex", name: "Google Workspace Business Starter (Flex)", category: "Google Workspace" },
  { sku: "Google-Workspace-MOS", name: "Google Workspace - Mail Only Support", category: "Google Workspace" },
  { sku: "Google-Ad-Campaign", name: "Google Ads Campaign Management", category: "Google Workspace" },
  { sku: "Google-Ad-Credit", name: "Google Ad Credit", category: "Google Workspace" },

  // Connectivity - Fibre
  { sku: "Fibre-25-10", name: "Fibre Uncapped 25/10 Mbps", category: "Connectivity" },
  { sku: "Fibre-25-25", name: "Fibre Uncapped 25/25 Mbps", category: "Connectivity" },
  { sku: "Fibre-50-25", name: "Fibre Uncapped 50/25 Mbps", category: "Connectivity" },
  { sku: "Fibre-50-50", name: "Fibre Uncapped 50/50 Mbps", category: "Connectivity" },
  { sku: "Fibre-100-50", name: "Fibre Uncapped 100/50 Mbps", category: "Connectivity" },
  { sku: "Fibre-100-100", name: "Fibre Uncapped 100/100 Mbps", category: "Connectivity" },
  { sku: "Fibre-150-150", name: "Fibre Uncapped 150/150 Mbps", category: "Connectivity" },
  { sku: "Fibre-200-100", name: "Fibre Uncapped 200/100 Mbps", category: "Connectivity" },
  { sku: "Vodacom-Business-Fibre", name: "Vodacom Business Fibre", category: "Connectivity" },

  // Connectivity - LTE
  { sku: "MTN-LTE-60GB", name: "MTN LTE 60GB Data", category: "Connectivity" },
  { sku: "Uncapped-LTE-100Mbps", name: "Uncapped LTE up to 100Mbps", category: "Connectivity" },
  { sku: "Off-Peak-Uncapped-LTE", name: "Off-Peak Uncapped LTE", category: "Connectivity" },
  { sku: "RAIN-UH5GS", name: "Rain Unlimited Home 5G Standard", category: "Connectivity" },
  { sku: "Static-IP", name: "Static IP Address", category: "Connectivity" },

  // VoIP
  { sku: "Virtual-PABX", name: "Virtual PABX Monthly", category: "VoIP" },
  { sku: "VoIP-Trunk", name: "VoIP Trunk Monthly Fee", category: "VoIP" },
  { sku: "VoIP-Ext", name: "VoIP Extension", category: "VoIP" },
  { sku: "VoIP-Number", name: "VoIP Phone Number", category: "VoIP" },
  { sku: "VoIP-Credit", name: "VoIP Credit", category: "VoIP" },

  // IT Support - Blue Package
  { sku: "IT-BLUE-PC", name: "IT Support - Blue Package - Desktop/Laptop", category: "IT Support" },
  { sku: "IT-BLUE-AP", name: "IT Support - Blue Package - Access Point", category: "IT Support" },
  { sku: "IT-BLUE-NETPRINT", name: "IT Support - Blue Package - Network Printer", category: "IT Support" },
  { sku: "IT-BLUE-PRINTER", name: "IT Support - Blue Package - Local USB Printer", category: "IT Support" },
  { sku: "IT-BLUE-ROUTER", name: "IT Support - Blue Package - Router", category: "IT Support" },
  { sku: "IT-BLUE-SMARTPHONE", name: "IT Support - Blue Package - Smart Phone", category: "IT Support" },

  // IT Support - Red Package
  { sku: "IT-RED-PC", name: "IT Support - Red Package - Desktop/Laptop", category: "IT Support" },
  { sku: "IT-RED-Mail-Only-Support", name: "IT Support - Red Package - Mail Only", category: "IT Support" },
  { sku: "IT-RED-NETPRINT", name: "IT Support - Red Package - Network Printer", category: "IT Support" },
  { sku: "IT-RED-PRINTER", name: "IT Support - Red Package - Local USB Printer", category: "IT Support" },
  { sku: "IT-RED-ROUTER", name: "IT Support - Red Package - Router", category: "IT Support" },
  { sku: "IT-RED-SERVER", name: "IT Support - Red Package - Server", category: "IT Support" },
  { sku: "IT-RED-VIRTUAL-SERVER", name: "IT Support - Red Package - Virtual Server", category: "IT Support" },
  { sku: "IT-Support-OOS", name: "IT Support - Out of Scope", category: "IT Support" },

  // MSP Packages
  { sku: "MSP-STANDARD-USER", name: "Managed IT Services - Standard Package User", category: "MSP Packages" },
  { sku: "MSP-ESSENTIAL-USER-BS", name: "IT Essentials Package User - 365 Business Standard", category: "MSP Packages" },
  { sku: "MSP-ADDITIONAL-EMAIL", name: "Managed IT Services - Additional Email + Archiving", category: "MSP Packages" },
  { sku: "MSP-STANDARD-EXTRA-MAILBOX", name: "MSP Standard - Extra Mailbox and Backup via Dropsuite", category: "MSP Packages" },
  { sku: "Entry-Package-Per-User", name: "Essential Package Per User (Microsoft 365 Tenant Managed)", category: "MSP Packages" },
  { sku: "Essential-Package-Per-User", name: "Essential Package Per User (Support, Security)", category: "MSP Packages" },
  { sku: "Essentials-Extra-PC", name: "Essentials Package - Extra PC for User", category: "MSP Packages" },
  { sku: "Essentials-Mail-Only", name: "Essentials Mail Only User (Email Protection + Backup)", category: "MSP Packages" },
  { sku: "Standard-Mail-Only", name: "Standard Mail Only User (Email Protection + Backup)", category: "MSP Packages" },
  { sku: "STANDARD-EXTRA-PC", name: "Standard Package - Extra PC", category: "MSP Packages" },
  { sku: "O365-Mail-Only-Support", name: "Office 365 Mail Only Support", category: "MSP Packages" },

  // Hosting
  { sku: "Hosting-Basic", name: "Hosting - Basic (5GB Traffic)", category: "Hosting" },
  { sku: "Hosting-Standard", name: "Hosting - Standard (10GB Traffic)", category: "Hosting" },
  { sku: "Hosting-Master", name: "Hosting - Master (20GB Storage)", category: "Hosting" },
  { sku: "Hosted-Unifi", name: "Hosted Unifi Controller", category: "Hosting" },
  { sku: "JPIT-Dedicated-Server", name: "JPIT Dedicated Server", category: "Hosting" },
  { sku: "Managed-Server", name: "Managed Server", category: "Hosting" },
  { sku: "OB", name: "Online Backup Service", category: "Hosting" },

  // Hardware
  { sku: "DELL", name: "Dell", category: "Hardware" },
  { sku: "HP", name: "HP Desktop PC", category: "Hardware" },
  { sku: "Kingston", name: "Kingston", category: "Hardware" },
  { sku: "Lenovo", name: "Lenovo", category: "Hardware" },
  { sku: "MSI", name: "MSI", category: "Hardware" },
  { sku: "Reyee", name: "Reyee", category: "Hardware" },

  // Other Services
  { sku: "JPIT-FIREWALL", name: "Just Plain IT Firewall (Content Filter)", category: "Security" },
  { sku: "Data-Migration-Per-User", name: "Data Migration Per User", category: "Services" },
  { sku: "Data-Recovery", name: "Data Recovery from HDD Mechanical Failure", category: "Services" },
  { sku: "Delivery", name: "Delivery", category: "Services" },
  { sku: "Same-Day-Delivery", name: "Same Day Delivery Fee", category: "Services" },
  { sku: "Onboarding", name: "Onboarding", category: "Services" },
  { sku: "Travel-Fee", name: "Travel Fee (per km return trip)", category: "Services" },
  { sku: "DISCOUNT", name: "Discount", category: "Services" },
  { sku: "SUNDRIES", name: "Sundries (Cables, Connectors etc)", category: "Services" },
  { sku: "MS-Win-HometoPro", name: "Microsoft Windows Home to Pro Upgrade", category: "Services" },
];

async function main() {
  // Seed admin user
  const existingUser = await prisma.user.findUnique({
    where: { email: "admin@jpit.co.za" },
  });

  if (!existingUser) {
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
  } else {
    console.log("Admin user already exists, skipping.");
  }

  // Seed products
  let created = 0;
  let skipped = 0;

  for (const product of products) {
    const existing = await prisma.product.findUnique({
      where: { sku: product.sku },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.product.create({
      data: {
        name: product.name,
        sku: product.sku,
        category: product.category,
        isActive: true,
      },
    });
    created++;
  }

  console.log(`Products: ${created} created, ${skipped} already existed (${products.length} total)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
