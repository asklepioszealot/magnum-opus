(function attachSharedStudyOrchestration(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedStudy || {};
  if (
    typeof existingNamespace.createOrchestrationPlan === "function" &&
    typeof existingNamespace.completeOrchestrationStep === "function"
  ) {
    return;
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function inferStrategy(session) {
    const focusText = `${normalizeText(session && session.focus)} ${normalizeText(
      session && session.notes,
    )}`.toLocaleLowerCase("tr-TR");

    if (/(recall|hatirla|hatırlama|kart|tekrar)/i.test(focusText)) {
      return {
        strategy: "Recall-first orchestration",
        orderedFlowIds: ["flashcards", "mcq"],
      };
    }

    if (/(sinav|sınav|test|exam|secenek|seçenek)/i.test(focusText)) {
      return {
        strategy: "Exam-first orchestration",
        orderedFlowIds: ["mcq", "flashcards"],
      };
    }

    return {
      strategy: "Active-flow-first orchestration",
      orderedFlowIds: [],
    };
  }

  function uniqueFlowIds(flowIds) {
    const seen = new Set();
    const ordered = [];

    flowIds.forEach((flowId) => {
      const normalized = normalizeText(flowId);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      ordered.push(normalized);
    });

    return ordered;
  }

  function createOrchestrationPlan(options = {}) {
    const session = options.session || {};
    const flowCatalog = Array.isArray(options.flowCatalog) ? options.flowCatalog : [];
    const completedFlowIds = uniqueFlowIds(options.completedFlowIds || []);
    const inferred = inferStrategy(session);

    const flowIds = uniqueFlowIds([
      ...inferred.orderedFlowIds,
      session.activeFlowId,
      session.preferredFlowId,
      ...flowCatalog.map((flow) => flow.id),
    ]).filter((flowId) => flowCatalog.some((flow) => flow.id === flowId));

    const firstPendingFlowId = flowIds.find((flowId) => !completedFlowIds.includes(flowId));

    const steps = flowIds.map((flowId, index) => {
      const flow = flowCatalog.find((candidate) => candidate.id === flowId);
      const isCompleted = completedFlowIds.includes(flowId);
      const status = isCompleted
        ? "completed"
        : flowId === firstPendingFlowId
          ? "in_progress"
          : "pending";

      return {
        order: index + 1,
        flowId,
        title: flow ? flow.title : flowId,
        reason: inferred.strategy,
        status,
      };
    });

    return {
      strategy: inferred.strategy,
      completedFlowIds,
      nextFlowId: firstPendingFlowId || "",
      steps,
    };
  }

  function completeOrchestrationStep(plan, flowId) {
    const completedFlowIds = uniqueFlowIds([
      ...(plan && Array.isArray(plan.completedFlowIds) ? plan.completedFlowIds : []),
      flowId,
    ]);

    return createOrchestrationPlan({
      session: {
        activeFlowId:
          plan && typeof plan.nextFlowId === "string" ? plan.nextFlowId : "",
        preferredFlowId:
          plan && Array.isArray(plan.steps) && plan.steps.length > 0
            ? plan.steps[0].flowId
            : "",
      },
      flowCatalog: Array.isArray(plan && plan.steps)
        ? plan.steps.map((step) => ({ id: step.flowId, title: step.title }))
        : [],
      completedFlowIds,
    });
  }

  globalScope.MagnumSharedStudy = Object.freeze({
    ...existingNamespace,
    createOrchestrationPlan,
    completeOrchestrationStep,
  });
})(window);
