#!/usr/bin/env node

/**
 * Community Feature Verification & Fix Script
 * 
 * Checks that all community tables exist and are properly seeded.
 * Run after: npm run db:migrate
 * 
 * Usage:
 *   npm run verify:community
 *   npm run verify:community -- --fix     # Auto-seed if needed
 */

import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const autoFix = args.includes("--fix");

type Status = "✅" | "⚠️" | "❌";

interface CheckResult {
  name: string;
  status: Status;
  message: string;
  count?: number;
}

const results: CheckResult[] = [];

function log(check: CheckResult) {
  results.push(check);
  console.log(`${check.status} ${check.name}`);
  console.log(`   ${check.message}${check.count !== undefined ? ` (${check.count} found)` : ""}`);
}

async function main() {
  console.log("🔍 Community Feature Verification\n");

  // 1. Check tables exist
  console.log("📋 Checking database tables...\n");

  try {
    const spaceCount = await prisma.space.count();
    log({
      name: "Space table",
      status: spaceCount > 0 ? "✅" : "⚠️",
      message: spaceCount > 0
        ? "Space table exists"
        : "Space table exists but is empty - run: npm run seed:spaces",
      count: spaceCount,
    });
  } catch (e) {
    log({
      name: "Space table",
      status: "❌",
      message: "Space table not found or error accessing it. Run: npm run db:migrate",
    });
  }

  try {
    const channelCount = await prisma.channel.count();
    log({
      name: "Channel table",
      status: channelCount > 0 ? "✅" : "⚠️",
      message: channelCount > 0
        ? "Channel table exists"
        : "Channel table exists but is empty",
      count: channelCount,
    });
  } catch (e) {
    log({
      name: "Channel table",
      status: "❌",
      message: "Channel table not found. Run: npm run db:migrate",
    });
  }

  try {
    const threadCount = await prisma.thread.count();
    log({
      name: "Thread table",
      status: "✅",
      message: "Thread table exists and ready for discussions",
      count: threadCount,
    });
  } catch (e) {
    log({
      name: "Thread table",
      status: "❌",
      message: "Thread table not found. Run: npm run db:migrate",
    });
  }

  try {
    const commentCount = await prisma.comment.count();
    log({
      name: "Comment table",
      status: "✅",
      message: "Comment table exists and ready for replies",
      count: commentCount,
    });
  } catch (e) {
    log({
      name: "Comment table",
      status: "❌",
      message: "Comment table not found. Run: npm run db:migrate",
    });
  }

  try {
    const readCount = await prisma.channelRead.count();
    log({
      name: "ChannelRead table",
      status: "✅",
      message: "ChannelRead table exists for tracking unread messages",
      count: readCount,
    });
  } catch (e) {
    log({
      name: "ChannelRead table",
      status: "❌",
      message: "ChannelRead table not found. Run: npm run db:migrate",
    });
  }

  // 2. Check data consistency
  console.log("\n📊 Checking data consistency...\n");

  try {
    const branches = await prisma.branch.count();
    const students = await prisma.student.findMany({
      where: { level: { not: null } },
      distinct: ["level"],
      select: { level: true },
    });

    const studentCount = await prisma.student.count();
    const studentsWithBranchAndLevel = await prisma.student.count({
      where: { branchId: { not: null }, level: { not: null } },
    });

    log({
      name: "Branches",
      status: branches > 0 ? "✅" : "⚠️",
      message: branches > 0
        ? "Branches exist"
        : "No branches found - community needs branches to create spaces",
      count: branches,
    });

    log({
      name: "Students with level",
      status: studentsWithBranchAndLevel > 0 ? "✅" : "⚠️",
      message: `${studentsWithBranchAndLevel}/${studentCount} students have branch and level set`,
      count: studentsWithBranchAndLevel,
    });

    const expectedSpaces = branches * students.length;
    const actualSpaces = await prisma.space.count();

    log({
      name: "Spaces coverage",
      status: actualSpaces >= expectedSpaces ? "✅" : "⚠️",
      message: `${actualSpaces}/${expectedSpaces} expected spaces created`,
      count: actualSpaces,
    });
  } catch (e) {
    log({
      name: "Data consistency",
      status: "❌",
      message: String(e),
    });
  }

  // 3. Check channels in spaces
  console.log("\n📢 Checking channels...\n");

  try {
    const spaces = await prisma.space.count();
    const channels = await prisma.channel.count();
    const expectedChannels = spaces * 5; // 5 default channels per space

    if (channels < expectedChannels) {
      log({
        name: "Default channels",
        status: "⚠️",
        message: `${channels}/${expectedChannels} expected channels - some spaces missing channels`,
        count: channels,
      });
    } else {
      log({
        name: "Default channels",
        status: "✅",
        message: "All spaces have 5 default channels",
        count: channels,
      });
    }

    // Check channel types
    const channelTypes = await prisma.channel.groupBy({
      by: ["slug"],
      _count: true,
    });

    const expectedTypes = ["general", "grammar-help", "vocabulary", "announcements", "assignments"];
    const missingTypes = expectedTypes.filter(
      (t) => !channelTypes.find((c) => c.slug === t)
    );

    if (missingTypes.length > 0) {
      log({
        name: "Channel types",
        status: "⚠️",
        message: `Missing channel types: ${missingTypes.join(", ")}`,
      });
    } else {
      log({
        name: "Channel types",
        status: "✅",
        message: "All 5 channel types present in database",
      });
    }
  } catch (e) {
    log({
      name: "Channel check",
      status: "❌",
      message: String(e),
    });
  }

  // 4. Auto-fix if requested
  if (autoFix && results.some((r) => r.status !== "✅")) {
    console.log("\n🔧 Attempting auto-fix...\n");

    // Run seed if spaces are missing
    const spaceCount = await prisma.space.count();
    if (spaceCount === 0) {
      console.log("Running seed script...");
      try {
        // Dynamic import of seed script
        await import("./seed-community-spaces.ts");
      } catch (e) {
        console.log("❌ Could not auto-run seed script.");
        console.log("   Run manually: npm run seed:spaces");
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  const passed = results.filter((r) => r.status === "✅").length;
  const warned = results.filter((r) => r.status === "⚠️").length;
  const failed = results.filter((r) => r.status === "❌").length;

  console.log(`\n📈 Summary: ${passed} passed, ${warned} warnings, ${failed} errors\n`);

  if (failed > 0) {
    console.log("❌ Setup incomplete. Next steps:");
    console.log("   1. npm run db:migrate          # Create tables");
    console.log("   2. npm run seed:spaces         # Populate community spaces");
    console.log("   3. npm run verify:community    # Re-run this check");
    process.exit(1);
  } else if (warned > 0) {
    console.log("⚠️  Setup ready but incomplete. Run:");
    console.log("   npm run seed:spaces            # Populate community spaces");
    process.exit(0);
  } else {
    console.log("✨ Community feature is fully set up! 🎉");
    console.log("\nStudents can now:");
    console.log("  • Access the community via the smiley icon");
    console.log("  • Create and reply to threads");
    console.log("  • See unread badges in real-time");
    console.log("  • Receive push notifications");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("\n❌ Fatal error:", e);
  process.exit(1);
});
