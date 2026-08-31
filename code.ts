figma.showUI(__html__, { width: 420, height: 560, title: "Image Replacer" });

function getImageNodes(nodes) {
  const result = [];
  function traverse(node) {
    if (
      node.type === "RECTANGLE" ||
      node.type === "ELLIPSE" ||
      node.type === "POLYGON" ||
      node.type === "STAR" ||
      node.type === "VECTOR" ||
      node.type === "FRAME" ||
      node.type === "COMPONENT" ||
      node.type === "INSTANCE"
    ) {
      const fills = node.fills;
      if (Array.isArray(fills) && fills.some((f) => f.type === "IMAGE")) {
        result.push(node);
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }
  for (const node of nodes) {
    traverse(node);
  }
  return result;
}

function sendImageNodes() {
  const selection = figma.currentPage.selection;
  const imageNodes = getImageNodes(selection);
  const nodeData = imageNodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));
  figma.ui.postMessage({ type: "image-nodes", nodes: nodeData });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "get-selection") {
    sendImageNodes();
  }

  if (msg.type === "replace-images") {
    const { nodeIds, imageData } = msg;
    let replaced = 0;
    for (const nodeId of nodeIds) {
      const node = figma.getNodeById(nodeId);
      if (!node) continue;
      try {
        const imageHash = figma.createImage(new Uint8Array(imageData)).hash;
        const newFill = {
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash,
        };
        const fills = Array.isArray(node.fills) ? [...node.fills] : [];
        const imageIndex = fills.findIndex((f) => f.type === "IMAGE");
        if (imageIndex !== -1) {
          fills[imageIndex] = newFill;
        } else {
          fills.push(newFill);
        }
        node.fills = fills;
        replaced++;
      } catch (e) {
        console.error("Error replacing image:", e);
      }
    }
    figma.ui.postMessage({ type: "done", replaced });
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }
};

figma.on("selectionchange", () => {
  sendImageNodes();
});

sendImageNodes();
