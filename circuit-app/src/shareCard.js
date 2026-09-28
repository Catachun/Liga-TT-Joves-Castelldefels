import { loadImage, roundRect, shareOrDownloadCanvas } from "./imageUtils";

// Generates a simple branded "Top 15" ranking share card.
export async function shareTop15Card(players, t) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    const logo = await loadImage("/logo.png");
    ctx.drawImage(logo, canvas.width / 2 - 60, 40, 120, 120);
  } catch {}

  ctx.fillStyle = "#fff";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(t("appName"), canvas.width / 2, 210);
  ctx.font = "28px sans-serif";
  ctx.fillText(t("share_top15"), canvas.width / 2, 250);

  const top = players.slice(0, 15);
  let y = 320;
  ctx.textAlign = "left";
  top.forEach((p, i) => {
    ctx.fillStyle = "#1e293b";
    roundRect(ctx, 60, y, canvas.width - 120, 60, 12);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(`${i + 1}. ${p.name}`, 90, y + 40);
    ctx.textAlign = "right";
    ctx.fillText(String(Math.round(p.elo || 500)), canvas.width - 90, y + 40);
    ctx.textAlign = "left";
    y += 70;
  });

  await shareOrDownloadCanvas(canvas, "top15.png", t("share_top15"));
}

// Generates a simple player profile share card.
export async function shareProfileCard(player, t) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (player.selfieUrl) {
    try {
      const img = await loadImage(player.selfieUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvas.width / 2, 300, 180, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, canvas.width / 2 - 180, 120, 360, 360);
      ctx.restore();
    } catch {}
  }

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "bold 54px sans-serif";
  ctx.fillText(player.name, canvas.width / 2, 570);
  ctx.font = "36px sans-serif";
  ctx.fillText(`${Math.round(player.elo || 500)} ELO`, canvas.width / 2, 630);
  ctx.font = "28px sans-serif";
  ctx.fillText(
    t("share_wl", { w: player.wins || 0, l: player.losses || 0 }),
    canvas.width / 2,
    680
  );

  await shareOrDownloadCanvas(canvas, `${player.name}.png`, t("share_profile"));
}
