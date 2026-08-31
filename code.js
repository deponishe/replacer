figma.showUI(__html__, { width: 440, height: 548, title: "Image Replacer" });

function isVisible(node) {
  let current = node;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function findAll(node, predicate, result = []) {
  if (!isVisible(node)) return result;
  if (predicate(node)) result.push(node);
  if ("children" in node) {
    for (const child of node.children) findAll(child, predicate, result);
  }
  return result;
}

function findImageInside(node) {
  if (!node) return null;
  if (["RECTANGLE","ELLIPSE"].includes(node.type) && node.name.toLowerCase() === "image") return node;
  if ("children" in node) {
    for (const child of node.children) {
      const found = findImageInside(child);
      if (found) return found;
    }
  }
  return null;
}

function formatName(fullName, useLineBreak) {
  const clean = fullName.trim().replace(/\s+/g, ' ');
  if (!useLineBreak) return clean;
  const spaceIdx = clean.indexOf(' ');
  if (spaceIdx === -1) return clean;
  return clean.slice(0, spaceIdx) + "\u2028" + clean.slice(spaceIdx + 1);
}

function collectTextNodes(ancestor, avatarNode) {
  const textNodes = [];
  function collect(node) {
    if (node.id === avatarNode.id) return;
    if (node.type === "TEXT") textNodes.push(node);
    if ("children" in node) {
      for (const child of node.children) collect(child);
    }
  }
  collect(ancestor);
  return textNodes;
}

async function updateName(avatarNode, nameValue, nameLayers) {
  let current = avatarNode.parent;
  for (let level = 1; level <= 3; level++) {
    if (!current || current.type === "PAGE") break;
    const textNodes = collectTextNodes(current, avatarNode);
    let found = false;
    for (const t of textNodes) {
      if (nameLayers.includes(t.name.toLowerCase().trim())) {
        try { await figma.loadFontAsync(t.fontName); t.characters = nameValue; found = true; } catch(e) {}
      }
    }
    if (found) return;
    current = current.parent;
  }
}

async function updateJob(avatarNode, jobValue, jobLayers) {
  let current = avatarNode.parent;
  if (current) current = current.parent;
  for (let level = 2; level <= 4; level++) {
    if (!current || current.type === "PAGE") break;
    const textNodes = collectTextNodes(current, avatarNode);
    let found = false;
    for (const t of textNodes) {
      if (jobLayers.includes(t.name.toLowerCase().trim())) {
        try { await figma.loadFontAsync(t.fontName); t.characters = jobValue; found = true; } catch(e) {}
      }
    }
    if (found) return;
    current = current.parent;
  }
}

async function updateTexts(avatarNode, fullName, job, useLineBreak, nameLayers, jobLayers) {
  if (!avatarNode) return;
  await updateName(avatarNode, formatName(fullName, useLineBreak), nameLayers);
  await updateJob(avatarNode, job, jobLayers);
}

function collectAvatarPairs(selection) {
  const pairs = [];
  const seen = new Set();
  const avatars = [];
  for (const node of selection) {
    findAll(node, n =>
      n.type === "INSTANCE" &&
      n.name.toLowerCase() === "avatar" &&
      isVisible(n), avatars);
  }

  for (const avatar of avatars) {
    if (seen.has(avatar.id)) continue;
    seen.add(avatar.id);

    const containers = findAll(avatar, n => n.name.toLowerCase() === "container");
    let containerImage = null;
    for (const c of containers) {
      containerImage = findImageInside(c);
      if (containerImage) break;
    }

    const addons = findAll(avatar, n => n.name.toLowerCase().includes("addon"));
    let addonImage = null;
    for (const a of addons) {
      addonImage = findImageInside(a);
      if (addonImage) break;
    }

    if (!addonImage) {
      let cur = avatar.parent;
      while (cur && cur.type !== "PAGE") {
        if ("children" in cur) {
          for (const sib of cur.children) {
            if (sib.id === avatar.id) continue;
            if (sib.name.toLowerCase().includes("addon")) {
              addonImage = findImageInside(sib);
              if (addonImage) break;
            }
            const addonInSib = findAll(sib, n => n.name.toLowerCase().includes("addon"));
            for (const a of addonInSib) {
              addonImage = findImageInside(a);
              if (addonImage) break;
            }
            if (addonImage) break;
          }
        }
        if (addonImage) break;
        cur = cur.parent;
      }
    }

    pairs.push({
      id: avatar.id,
      name: avatar.name,
      hasAddon: !!addonImage,
      containerImageId: containerImage ? containerImage.id : null,
      addonImageId: addonImage ? addonImage.id : null
    });
  }
  return pairs;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPersonQueue(totalAvatars, totalPersons) {
  const queue = [];
  while (queue.length < totalAvatars) {
    queue.push(...shuffle([...Array(totalPersons).keys()]));
  }
  return queue.slice(0, totalAvatars);
}

async function replaceAll(nodeIds, imagesBank, companyBank, personNames, personToCompany, personToName, personToJob, nameLayers, jobLayers, useLineBreak) {
  const personQueue = buildPersonQueue(nodeIds.length, personNames.length);
  let replaced = 0;
  let skipped = 0;
  let queueIndex = 0;

  for (const item of nodeIds) {
    const containerImage = item.containerImageId ? figma.getNodeById(item.containerImageId) : null;
    const addonImage     = item.addonImageId     ? figma.getNodeById(item.addonImageId)     : null;
    const avatarNode     = figma.getNodeById(item.id);

    if (!containerImage) { skipped++; queueIndex++; continue; }

    try {
      const personIndex  = personQueue[queueIndex++];
      const personKey    = personNames[personIndex];
      const fullName     = personToName[personKey] || personKey;
      const job          = personToJob[personKey]  || "";

      // Вставляем оригинальные байты напрямую (lossless)
      const avatarBytes = new Uint8Array(imagesBank[personIndex]);
      const avatarHash = figma.createImage(avatarBytes).hash;
      containerImage.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: avatarHash }];
      replaced++;

      if (addonImage && companyBank && companyBank.length > 0) {
        const companyIndex = personToCompany[personKey] !== undefined ? personToCompany[personKey] : 0;
        const safeIndex    = Math.min(companyIndex, companyBank.length - 1);
        
        const companyBytes = new Uint8Array(companyBank[safeIndex]);
        const hash = figma.createImage(companyBytes).hash;
        addonImage.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
      }

      await updateTexts(avatarNode, fullName, job, useLineBreak, nameLayers, jobLayers);

    } catch(e) {
      console.error("Error replacement:", item.id, e);
      skipped++;
    }
  }

  return { replaced, skipped };
}

function deleteHiddenLayersInSelection(selection) {
  let count = 0;
  function removeHidden(node) {
    let localCount = 0;
    if (node.visible === false) {
      try {
        node.remove();
        return 1;
      } catch (e) {
        return 0;
      }
    }
    if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        localCount += removeHidden(node.children[i]);
      }
    }
    return localCount;
  }
  for (const s of selection) {
    count += removeHidden(s);
  }
  return count;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "count-nodes") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "image-nodes", nodes: [], error: "Ничего не выделено" });
      return;
    }
    figma.ui.postMessage({ type: "image-nodes", nodes: collectAvatarPairs(selection) });
  }

  if (msg.type === "delete-hidden") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "delete-hidden-done", error: "Ничего не выделено! Выделите фрейм." });
      return;
    }
    const count = deleteHiddenLayersInSelection(selection);
    figma.ui.postMessage({ type: "delete-hidden-done", count: count });
  }

  if (msg.type === "replace-images-random") {
    const { nodeIds, imagesBank, companyBank, personNames, personToCompany, personToName, personToJob, nameLayers, jobLayers, filter } = msg;
    let replaced = 0;
    let skipped  = 0;

    if (filter === "all") {
      ({ replaced, skipped } = await replaceAll(nodeIds, imagesBank, companyBank, personNames, personToCompany, personToName, personToJob, nameLayers, jobLayers, false));

    } else if (filter === "rec") {
      ({ replaced, skipped } = await replaceAll(nodeIds, imagesBank, companyBank, personNames, personToCompany, personToName, personToJob, nameLayers, jobLayers, true));

    } else if (filter === "people") {
      const personQueue = buildPersonQueue(nodeIds.length, personNames.length);
      let qi = 0;
      for (const item of nodeIds) {
        const containerImage = item.containerImageId ? figma.getNodeById(item.containerImageId) : null;
        const avatarNode     = figma.getNodeById(item.id);
        if (!containerImage || !imagesBank || imagesBank.length === 0) { skipped++; qi++; continue; }
        try {
          const personIndex = personQueue[qi++];
          const personKey   = personNames[personIndex];
          const fullName    = personToName[personKey] || personKey;
          const job         = personToJob[personKey]  || "";
          const avatarBytes = new Uint8Array(imagesBank[personIndex]);
          const hash = figma.createImage(avatarBytes).hash;
          containerImage.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
          replaced++;
          await updateTexts(avatarNode, fullName, job, false, nameLayers, jobLayers);
        } catch(e) { skipped++; }
      }

    } else if (filter === "company") {
      for (const item of nodeIds) {
        const containerImage = item.containerImageId ? figma.getNodeById(item.containerImageId) : null;
        const addonImage     = item.addonImageId     ? figma.getNodeById(item.addonImageId)     : null;
        if (!companyBank || companyBank.length === 0) { skipped++; continue; }
        try {
          const randomCompany = companyBank[Math.floor(Math.random() * companyBank.length)];
          const companyBytes = new Uint8Array(randomCompany);
          const hash = figma.createImage(companyBytes).hash;
          if (addonImage) {
            addonImage.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
            replaced++;
          } else if (containerImage) {
            containerImage.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
            replaced++;
          } else { skipped++; }
        } catch(e) { skipped++; }
      }
    }

    figma.ui.postMessage({ type: "done", replaced, skipped });
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }
};
