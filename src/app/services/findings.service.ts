import { Injectable, computed, signal } from '@angular/core';

import { Finding, ToolKind } from '../models/finding.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FindingsService {
  // all findings in one place
  private readonly _all = signal<Finding[]>([]);

  // public read-only views
  readonly all = computed(() => this._all());
  readonly count = computed(() => this._all().length);
  private readonly _aiSummary = signal<string>('');
  private readonly _safetyScore = signal<number | null>(null);
  readonly aiSummary = computed(() => this._aiSummary());
  readonly safetyScore = computed(() => this._safetyScore());

  byTool = (tool: ToolKind) =>
    computed(() => this._all().filter((f) => f.tool === tool));

  // add or replace by id
  add(list: Finding[]) {
    if (!list?.length) return;
    const map = new Map(this._all().map((f) => [f.id, f]));
    for (const f of list) map.set(f.id, { ...map.get(f.id), ...f });
    this._all.set([...map.values()]);
  }

  // remove everything, or only one tool
  clear(tool?: ToolKind) {
    if (!tool) {
      this._all.set([]);
      return;
    }
    this._all.set(this._all().filter((f) => f.tool !== tool));
  }

  // update one finding by id
  patch(id: string, patch: Partial<Finding>) {
    this._all.update((arr) =>
      arr.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );
  }

  setAiSummary(summary: string) {
    this._aiSummary.set(summary || '');
  }

  setSafetyScore(score: number | null) {
    if (score === null || Number.isNaN(score)) {
      this._safetyScore.set(null);
      return;
    }
    this._safetyScore.set(Math.min(10, Math.max(0, score)));
  }

  loadMockFindings() {
    // const mock: Finding[] = [
    //   {
    //     id: 'semgrep-0',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.agent.unbounded-loop.py',
    //     message:
    //       'Agent loop without max iterations / timeouts. Add guards. (Agentic T4 / LLM04)',
    //     severity: 'medium',
    //     location: {
    //       file: 'repo/cli2.py',
    //       line: 56,
    //       snippet:
    //         "    while True:\n        goal = input(\"Enter a goal (or 'q' to quit): \")\n        if goal == 'q':\n            break\n        goals.append(goal)",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'An unbounded while loop accepting user input can lead to resource exhaustion or denial of service if an attacker provides continuous input without triggering the exit condition. Adding iteration limits and timeouts prevents malicious or accidental infinite loops from consuming system resources.',
    //     aiRemediation: [
    //       'Add a maximum iteration counter: max_iterations = 100; iteration = 0; while iteration < max_iterations:',
    //       'Implement a timeout using signal.alarm() or threading.Timer to interrupt the loop after N seconds',
    //       'Add input validation to reject excessively long strings or rate-limit input frequency',
    //       'Log and alert when iteration limits are approached to detect abuse patterns',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-1',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.agent.unbounded-loop.py',
    //     message:
    //       'Agent loop without max iterations / timeouts. Add guards. (Agentic T4 / LLM04)',
    //     severity: 'low',
    //     location: {
    //       file: 'repo/cli2.py',
    //       line: 68,
    //       snippet:
    //         '        while True:\n            try:\n                sleep(30)\n            except KeyboardInterrupt:\n                cleanup(api_process, ui_process, celery_process)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'This loop is designed for long-running process management and relies on KeyboardInterrupt for exit. While less critical than input-driven loops, it lacks explicit timeout or health-check mechanisms, potentially leaving zombie processes if cleanup fails.',
    //     aiRemediation: [
    //       'Add a maximum runtime duration check: elapsed_time = 0; max_runtime = 86400 (24 hours); elapsed_time += 30; if elapsed_time > max_runtime: break',
    //       'Implement health checks for child processes to detect and restart failed ones',
    //       'Add a graceful shutdown signal handler (SIGTERM) in addition to KeyboardInterrupt',
    //       'Log process status periodically to detect hangs or resource leaks',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-2',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.agent.unbounded-loop.py',
    //     message:
    //       'Agent loop without max iterations / timeouts. Add guards. (Agentic T4 / LLM04)',
    //     severity: 'low',
    //     location: {
    //       file: 'repo/run_gui.py',
    //       line: 45,
    //       snippet:
    //         '        while True:\n            try:\n                sleep(30)\n            except KeyboardInterrupt:\n                cleanup(api_process, ui_process)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Similar to semgrep-1, this process management loop lacks explicit timeout guards. Extended runtime without health checks or restart logic can lead to resource accumulation or stale process states.',
    //     aiRemediation: [
    //       'Add elapsed time tracking with a configurable max_runtime threshold',
    //       'Implement periodic health checks for api_process and ui_process',
    //       'Add signal handlers for SIGTERM and SIGHUP for graceful shutdown and reload',
    //       'Monitor memory and CPU usage; restart processes if thresholds are exceeded',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-3',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/agent/output_handler.py',
    //       line: 149,
    //       snippet: '        tasks = eval(assistant_reply)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() if only literal structures (lists, dicts, strings) are needed',
    //       'Use json.loads() if the output is JSON-formatted',
    //       'Implement a whitelist-based parser that only accepts specific task structures and validates all fields',
    //       'If dynamic code execution is required, use a sandboxed environment like RestrictedPython or a separate process with limited privileges',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-4',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/agent/output_handler.py',
    //       line: 180,
    //       snippet: '        tasks = eval(assistant_reply)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() if only literal structures (lists, dicts, strings) are needed',
    //       'Use json.loads() if the output is JSON-formatted',
    //       'Implement a whitelist-based parser that only accepts specific task structures and validates all fields',
    //       'If dynamic code execution is required, use a sandboxed environment like RestrictedPython or a separate process with limited privileges',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-5',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/agent/queue_step_handler.py',
    //       line: 79,
    //       snippet:
    //         '        task_array = np.array(eval(assistant_reply)).flatten().tolist()',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the list structure',
    //       'Use json.loads() if the output is JSON-formatted',
    //       'Validate the parsed array structure and element types before passing to np.array()',
    //       'Consider using numpy.fromstring() or pandas.read_json() with strict type validation instead',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-6',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/agent/task_queue.py',
    //       line: 33,
    //       snippet: '        return [eval(task) for task in tasks]',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() for each task in the list comprehension',
    //       'Use json.loads() if tasks are JSON-formatted strings',
    //       'Implement a Task class with a from_string() factory method that validates and safely deserializes task data',
    //       'Add type hints and runtime validation to ensure tasks conform to expected schema',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-7',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/agent/task_queue.py',
    //       line: 43,
    //       snippet: '        return eval(response)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() if only literal structures are expected',
    //       'Use json.loads() if the response is JSON-formatted',
    //       'Implement a response parser that validates the structure and type of the response before use',
    //       'Add explicit error handling and logging for malformed responses',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-8',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/controllers/agent_template.py',
    //       line: 251,
    //       snippet:
    //         '                config_value = str(Tool.convert_tool_ids_to_names(db, eval(config.value)))',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the config value',
    //       'Use json.loads() if config values are JSON-formatted',
    //       'Validate that config.value contains only expected data types (list of IDs) before parsing',
    //       'Implement a schema validation layer for all configuration values before deserialization',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-9',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/controllers/agent_template.py',
    //       line: 466,
    //       snippet:
    //         '            config_value = str(Tool.convert_tool_ids_to_names(db, eval(agent_execution_configuration.value)))',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the configuration value',
    //       'Use json.loads() if configuration values are JSON-formatted',
    //       'Validate that agent_execution_configuration.value contains only expected data types before parsing',
    //       'Implement a schema validation layer for all execution configuration values',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-10',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/controllers/knowledges.py',
    //       line: 157,
    //       snippet: '    vector_ids = eval(knowledge_config["vector_ids"])',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the vector_ids list',
    //       'Use json.loads() if vector_ids are JSON-formatted',
    //       'Validate that all elements in vector_ids are valid identifiers (strings or integers) before use',
    //       'Add type hints and runtime validation for knowledge_config structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-11',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent.py',
    //       line: 116,
    //       snippet: '            return eval(value)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the value',
    //       'Use json.loads() if the value is JSON-formatted',
    //       'Add type checking and validation before returning the parsed value',
    //       'Document the expected format and implement strict schema validation',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-12',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 110,
    //       snippet: '            return eval(value)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the value',
    //       'Use json.loads() if the value is JSON-formatted',
    //       'Add type checking and validation before returning the parsed value',
    //       'Document the expected format and implement strict schema validation',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-13',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 123,
    //       snippet:
    //         "            results_agent_dict['goal'] = eval(results_agent_dict['goal'])",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the goal value',
    //       'Use json.loads() if the goal is JSON-formatted',
    //       'Validate that the goal is a string or list of strings before assignment',
    //       'Add schema validation for the entire results_agent_dict structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-14',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 133,
    //       snippet:
    //         "            results_agent_dict['instruction'] = eval(results_agent_dict['instruction'])",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the instruction value',
    //       'Use json.loads() if the instruction is JSON-formatted',
    //       'Validate that the instruction is a string or list of strings before assignment',
    //       'Add schema validation for the entire results_agent_dict structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-15',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 136,
    //       snippet:
    //         "            results_agent_dict['constraints'] = eval(results_agent_dict['constraints'])",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the constraints value',
    //       'Use json.loads() if constraints are JSON-formatted',
    //       'Validate that constraints is a list of strings before assignment',
    //       'Add schema validation for the entire results_agent_dict structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-16',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 161,
    //       snippet:
    //         "            results_agent_dict['goal'] = eval(results_agent_dict['goal'])",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the goal value',
    //       'Use json.loads() if the goal is JSON-formatted',
    //       'Validate that the goal is a string or list of strings before assignment',
    //       'Add schema validation for the entire results_agent_dict structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-17',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 171,
    //       snippet:
    //         "            results_agent_dict['instruction'] = eval(results_agent_dict['instruction'])",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the instruction value',
    //       'Use json.loads() if the instruction is JSON-formatted',
    //       'Validate that the instruction is a string or list of strings before assignment',
    //       'Add schema validation for the entire results_agent_dict structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-18',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_execution_config.py',
    //       line: 174,
    //       snippet:
    //         "            results_agent_dict['constraints'] = eval(results_agent_dict['constraints'])",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the constraints value',
    //       'Use json.loads() if constraints are JSON-formatted',
    //       'Validate that constraints is a list of strings before assignment',
    //       'Add schema validation for the entire results_agent_dict structure',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-19',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_template.py',
    //       line: 224,
    //       snippet: '            return eval(value)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the value',
    //       'Use json.loads() if the value is JSON-formatted',
    //       'Add type checking and validation before returning the parsed value',
    //       'Document the expected format and implement strict schema validation',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-20',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.llm.eval.exec',
    //     message:
    //       'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
    //     severity: 'critical',
    //     location: {
    //       file: 'repo/superagi/models/agent_template.py',
    //       line: 226,
    //       snippet: '            return [str(x) for x in eval(value)]',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'Using eval() on LLM-generated output is a critical code injection vulnerability. An attacker or compromised LLM can execute arbitrary Python code with full application privileges, leading to data theft, system compromise, or lateral movement.',
    //     aiRemediation: [
    //       'Replace eval() with ast.literal_eval() to safely parse the value as a list',
    //       'Use json.loads() if the value is JSON-formatted',
    //       'Validate that the parsed value is iterable and contains only string-convertible elements',
    //       'Add error handling for non-iterable or malformed values',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-21',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.agent.unbounded-loop.py',
    //     message:
    //       'Agent loop without max iterations / timeouts. Add guards. (Agentic T4 / LLM04)',
    //     severity: 'medium',
    //     location: {
    //       file: 'repo/test.py',
    //       line: 33,
    //       snippet:
    //         "    while True:\n        goal = input(\"Enter a goal (or 'q' to quit): \")\n        if goal == 'q':\n            break\n        goals.append(goal)",
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'An unbounded while loop accepting user input can lead to resource exhaustion or denial of service if an attacker provides continuous input without triggering the exit condition. Adding iteration limits and timeouts prevents malicious or accidental infinite loops from consuming system resources.',
    //     aiRemediation: [
    //       'Add a maximum iteration counter: max_iterations = 100; iteration = 0; while iteration < max_iterations:',
    //       'Implement a timeout using signal.alarm() or threading.Timer to interrupt the loop after N seconds',
    //       'Add input validation to reject excessively long strings or rate-limit input frequency',
    //       'Log and alert when iteration limits are approached to detect abuse patterns',
    //     ],
    //   },
    //   {
    //     id: 'semgrep-22',
    //     tool: 'semgrep',
    //     ruleId: 'rules.agent-security.ai.agent.unbounded-loop.py',
    //     message:
    //       'Agent loop without max iterations / timeouts. Add guards. (Agentic T4 / LLM04)',
    //     severity: 'low',
    //     location: {
    //       file: 'repo/ui.py',
    //       line: 56,
    //       snippet:
    //         '        while True:\n            try:\n                sleep(30)\n            except KeyboardInterrupt:\n                cleanup(api_process, ui_process, celery_process)',
    //     },
    //     fingerprints: {
    //       'matchBasedId/v1': 'requires login',
    //     },
    //     aiExplanation:
    //       'This process management loop lacks explicit timeout guards. Extended runtime without health checks or restart logic can lead to resource accumulation or stale process states.',
    //     aiRemediation: [
    //       'Add elapsed time tracking with a configurable max_runtime threshold',
    //       'Implement periodic health checks for api_process and ui_process',
    //       'Add signal handlers for SIGTERM and SIGHUP for graceful shutdown and reload',
    //       'Monitor memory and CPU usage; restart processes if thresholds are exceeded',
    //     ],
    //   },
    // ];
    const mock: Finding[] = [
      {
        id: 'semgrep-1',
        tool: 'semgrep',
        ruleId: 'rules.agent-security.ai.llm.eval.exec',
        message:
          'Executing/evaluating LLM-generated code. Use a hardened sandbox or remove. (Agentic T11 / LLM02)',
        severity: 'low',
        location: {
          file: 'repo/SAST/python/injection/dynamic-code-injection.py',
          line: 8,
          snippet: 'eval(f"product_{operation}()") # Noncompliant',
        },
        fingerprints: {
          'matchBasedId/v1': 'requires login',
        },
        aiExplanation:
          'This code dynamically evaluates LLM-generated input using eval, which can execute arbitrary code. This creates a critical security risk by allowing unintended commands or payloads to run at runtime.',
        aiRemediation: [
          'Remove use of eval and replace with an explicit allowlist of supported operations',
          'Map operations to predefined functions instead of dynamically constructing code',
          'If dynamic execution is unavoidable, isolate execution in a hardened sandbox with strict resource and permission limits',
          'Add input validation and logging to detect unexpected operation values',
        ],
      },
    ];

    this._all.set(mock);
    this.setAiSummary(
      'Critical security posture: 14 code injection vulnerabilities via eval() on LLM-generated content, 4 unbounded loops risking denial-of-service. Immediate remediation required—replace eval() with json.loads()/ast.literal_eval() and add iteration limits/timeouts.'
    );
    this.setSafetyScore(3.5);

    // Optional: simulate latency so spinners can be tested
    // setTimeout(() => this._all.set(mock), 600);
  }

  /** call this once at app start if flag is on */
  initDevMockIfEnabled() {
    if (environment.devConfigs.mockMode) this.loadMockFindings();
  }
}
