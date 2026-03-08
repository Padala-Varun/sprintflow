import React from "react";
import ReactFlow from "reactflow";
import "reactflow/dist/style.css";

function TaskGraph({ tickets }) {
  const nodes = tickets.map((t) => ({
    id: String(t.id),
    data: { label: `${t.id}: ${t.task}` },
    position: { x: t.id * 150, y: 100 },
  }));

  const edges = tickets
    .filter((t) => t.dependency !== 0)
    .map((t) => ({
      id: `e${t.dependency}-${t.id}`,
      source: String(t.dependency),
      target: String(t.id),
    }));

  return (
    <div style={{ height: 400 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView />
    </div>
  );
}

export default TaskGraph;
