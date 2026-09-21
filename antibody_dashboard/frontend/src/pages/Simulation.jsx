import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API_BASE =
  import.meta.env.VITE_API_BASE || "http://127.0.0.1:8010";

export default function Simulation() {

  const logOffsetRef = useRef(0);
  const calibrationLogOffsetRef = useRef(0);
  const logBoxRef = useRef(null);
  const liveOutputSectionRef = useRef(null);
  const logSelectionRef = useRef(false);
  const [mode, setMode] = useState("aa");

  const [jobs, setJobs] = useState([]);
  const [calibrations, setCalibrations] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [liveLog, setLiveLog] = useState("");
  const [calibrationLog, setCalibrationLog] = useState("");

  const [lockedJobs, setLockedJobs] = useState(() => {
    try {
      const raw = localStorage.getItem("lockedJobs");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem(
      "lockedJobs",
      JSON.stringify([...lockedJobs])
    );
  }, [lockedJobs]);

  const [lockedCalibrations, setLockedCalibrations] = useState(() => {
    try {
      const raw = localStorage.getItem("lockedCalibrations");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem(
      "lockedCalibrations",
      JSON.stringify([...lockedCalibrations])
    );
  }, [lockedCalibrations]);

  // Refresh simulation and calibration history every second.
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const [jobsResponse, calibrationsResponse] = await Promise.all([
          fetch(`${API_BASE}/api/jobs?limit=50`),
          fetch(`${API_BASE}/api/calibration?limit=50`),
        ]);

        if (!jobsResponse.ok) {
          throw new Error(`Jobs HTTP ${jobsResponse.status}`);
        }

        if (!calibrationsResponse.ok) {
          throw new Error(
            `Calibrations HTTP ${calibrationsResponse.status}`
          );
        }

        const [jobsData, calibrationsData] = await Promise.all([
          jobsResponse.json(),
          calibrationsResponse.json(),
        ]);

        if (!cancelled) {
          setJobs(jobsData);
          setCalibrations(calibrationsData);
          setHistoryError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryError(error.message);
        }
      }
    }

    loadHistory();

    const timer = setInterval(loadHistory, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Stream only new log output for the selected simulation.
  useEffect(() => {
    if (!selectedJobId) {
      setLiveLog("");
      logOffsetRef.current = 0;
      return;
    }

    let cancelled = false;

    // Start from the beginning whenever a different job is selected.
    setLiveLog("");
    logOffsetRef.current = 0;

    async function loadLog() {
      try {
        const response = await fetch(
          `${API_BASE}/api/jobs/${selectedJobId}/log?offset=${logOffsetRef.current}`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const chunk = await response.text();

        const newOffset = Number(
          response.headers.get("X-Log-Offset") ||
            logOffsetRef.current
        );

        if (!cancelled && chunk && !logSelectionRef.current) {
          setLiveLog((previous) => {
            const updated = previous + chunk;
            return updated.slice(-100000);
          });
        }

        if (!logSelectionRef.current) {
          logOffsetRef.current = newOffset;
        }
      } catch (error) {
        console.error(
          "Could not read simulation log:",
          error
        );
      }
    }

    loadLog();

    const timer = setInterval(loadLog, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedJobId]);


  // Always keep the newest simulation output visible.
  useEffect(() => {
    if (!liveLog) {
      return;
    }

    // Keep the terminal itself at the newest line.
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop =
        logBoxRef.current.scrollHeight;
    }

    // Keep the whole terminal section visible on the page.
    liveOutputSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [liveLog, calibrationLog]);

  // Resume live updates when the user clears the text selection.
  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection()?.toString();

      if (!selection) {
        logSelectionRef.current = false;
      }
    }

    document.addEventListener(
      "selectionchange",
      handleSelectionChange
    );

    return () => {
      document.removeEventListener(
        "selectionchange",
        handleSelectionChange
      );
    };
  }, []);

  // Resume live output only when the user clicks outside the terminal.
  useEffect(() => {
    function handleMouseDown(event) {
      if (
        logBoxRef.current &&
        !logBoxRef.current.contains(event.target)
      ) {
        logSelectionRef.current = false;
      }
    }

    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener(
        "mousedown",
        handleMouseDown
      );
    };
  }, []);

  const [aaDuration, setAaDuration] = useState(50);
  const [martiniDuration, setMartiniDuration] = useState(500);

  const [martiniModel, setMartiniModel] = useState("elastic");

  const [elasticForce, setElasticForce] = useState(250);
  const [elasticLower, setElasticLower] = useState(0.5);
  const [elasticUpper, setElasticUpper] = useState(0.7);
  const [goEpsilon, setGoEpsilon] = useState(9.414);
  const [goLower, setGoLower] = useState(0.3);
  const [goUpper, setGoUpper] = useState(1.1);

  const [proteinFile, setProteinFile] = useState(null);

  const [saltConcentration, setSaltConcentration] = useState("0.15");
  const [temperature, setTemperature] = useState("310");
  const [cpuThreads, setCpuThreads] = useState(8);

  const [calibrationAaJobId, setCalibrationAaJobId] = useState("");
  const [calibrationDuration, setCalibrationDuration] = useState(10);
  const [calibrationThreads, setCalibrationThreads] = useState(4);
  const [calibrationParallel, setCalibrationParallel] = useState(2);
  const [calibrationReplicas, setCalibrationReplicas] = useState(1);
  const [calibrationModel, setCalibrationModel] = useState("elastic");
  const [calibrationGoEpsilons, setCalibrationGoEpsilons] = useState("6,8,9.414,11,13");
  const [calibrationGoLowers, setCalibrationGoLowers] = useState("0.2,0.3,0.4");
  const [calibrationGoUppers, setCalibrationGoUppers] = useState("0.9,1.1,1.3");
  const [calibrationForces, setCalibrationForces] =
    useState("100,200,300,400,500,600,700,800");
  const [calibrationLowers, setCalibrationLowers] = useState("0.4,0.5");
  const [calibrationUppers, setCalibrationUppers] = useState("0.7,0.8,0.9");

  const [calibrationId, setCalibrationId] = useState(() => {
    try {
      return localStorage.getItem("lastCalibrationId") || null;
    } catch {
      return null;
    }
  });
  const [calibrationStatus, setCalibrationStatus] = useState(null);
  const [calibrationError, setCalibrationError] = useState(null);
  const [calibrationResults, setCalibrationResults] = useState([]);
  const [calibrationResultsLoading, setCalibrationResultsLoading] = useState(false);
  const [calibrationResultsError, setCalibrationResultsError] = useState(null);

  // Keep the most recent calibration selected across dashboard reloads/crashes.
  useEffect(() => {
    try {
      if (calibrationId) {
        localStorage.setItem("lastCalibrationId", calibrationId);
      }
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  }, [calibrationId]);

  async function createAAJob() {
    if (!proteinFile) {
      alert("Please select an antibody PDB first.");
      return;
    }

    const form = new FormData();

    form.append("protein_pdb", proteinFile);
    form.append("method", "aa");
    form.append("duration_ns", aaDuration);
    form.append(
      "name",
      proteinFile.name.replace(/\.[^/.]+$/, "")
    );

    // Send a real numeric value to FastAPI.
    form.append("salt_concentration", String(parseFloat(saltConcentration)));
    form.append("temperature", String(parseFloat(temperature)));
    form.append("nt", String(cpuThreads));

    const response = await fetch(
      `${API_BASE}/api/jobs`,
      {
        method: "POST",
        body: form,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }

    const data = await response.json();

    // Automatically select the new run so the live terminal follows it.
    if (data?.job_id) {
      setSelectedJobId(data.job_id);
    }

    return data;
  }

  // Create and launch a Martini simulation job.
  async function createMartiniJob() {
    if (!proteinFile) {
      alert("Please select an antibody PDB first.");
      return;
    }

    const form = new FormData();

    form.append("protein_pdb", proteinFile);
    form.append("method", "martini");
    form.append("duration_ns", martiniDuration);

    form.append(
      "name",
      proteinFile.name.replace(/\.[^/.]+$/, "")
    );

    form.append("model", martiniModel);
    if (martiniModel === "elastic") {
      form.append("elastic_force", elasticForce);
      form.append("elastic_lower", elasticLower);
      form.append("elastic_upper", elasticUpper);
    } else if (martiniModel === "go") {
      form.append("go_epsilon", goEpsilon);
      form.append("go_lower", goLower);
      form.append("go_upper", goUpper);
    }

    form.append(
      "salt_concentration",
      String(parseFloat(saltConcentration))
    );

    form.append(
      "temperature",
      String(parseFloat(temperature))
    );

    form.append("nt", String(cpuThreads));

    const response = await fetch(
      `${API_BASE}/api/jobs`,
      {
        method: "POST",
        body: form,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }

    const data = await response.json();

    // Automatically follow the newly created Martini run.
    if (data?.job_id) {
      setSelectedJobId(data.job_id);
    }

    return data;
  }

  async function createCalibration() {
    if (!calibrationAaJobId) {
      alert("Please select a completed AA job first.");
      return;
    }

    const form = new FormData();

    form.append("aa_job_id", calibrationAaJobId);
    form.append("duration_ns", String(calibrationDuration));
    form.append("nt", String(calibrationThreads));
    form.append("parallel", String(calibrationParallel));
    form.append("replicas", String(calibrationReplicas));
    form.append("model", calibrationModel);
    if (calibrationModel === "go") {
      form.append("epsilons", calibrationGoEpsilons);
      form.append("lowers", calibrationGoLowers);
      form.append("uppers", calibrationGoUppers);
    } else {
      form.append("forces", calibrationForces);
      form.append("lowers", calibrationLowers);
      form.append("uppers", calibrationUppers);
    }

    const response = await fetch(
      `${API_BASE}/api/calibration`,
      {
        method: "POST",
        body: form,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Could not start calibration");
    }

    const data = await response.json();

    setCalibrationId(data.calibration_id);
    setCalibrationLog("");
    setCalibrationResults([]);
    setCalibrationResultsError(null);
    calibrationLogOffsetRef.current = 0;
    setCalibrationStatus({
      status: data.status || "running",
      completed: 0,
      total: 0,
      progress_percent: 0,
      successful: 0,
      failed: 0,
      top_results: [],
    });
    setCalibrationError(null);

    return data;
  }

  useEffect(() => {
    if (!calibrationId) {
      return;
    }

    let cancelled = false;

    async function loadCalibrationStatus() {
      try {
        const response = await fetch(
          `${API_BASE}/api/calibration/${calibrationId}/status`
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            text || `Calibration status HTTP ${response.status}`
          );
        }

        const data = await response.json();

        if (!cancelled) {
          setCalibrationStatus(data);
          setCalibrationError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCalibrationError(error.message);
        }
      }
    }

    loadCalibrationStatus();

    const timer = setInterval(loadCalibrationStatus, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [calibrationId]);

  // Load the complete calibration grid from the backend results endpoint.
  // The backend endpoint should parse this calibration's results.csv and return
  // either an array of rows or { results: [...] }.
  useEffect(() => {
    if (!calibrationId) {
      setCalibrationResults([]);
      setCalibrationResultsError(null);
      setCalibrationResultsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadCalibrationResults() {
      try {
        setCalibrationResultsLoading(true);

        const response = await fetch(
          `${API_BASE}/api/calibration/${calibrationId}/results`
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            text || `Calibration results HTTP ${response.status}`
          );
        }

        const data = await response.json();
        const rows = Array.isArray(data) ? data : data?.results;

        if (!Array.isArray(rows)) {
          throw new Error("Calibration results response is not an array.");
        }

        if (!cancelled) {
          setCalibrationResults(rows);
          setCalibrationResultsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCalibrationResultsError(error.message);
        }
      } finally {
        if (!cancelled) {
          setCalibrationResultsLoading(false);
        }
      }
    }

    loadCalibrationResults();

    // Keep the slice view current while a grid is still running.
    const timer =
      calibrationStatus?.status === "running"
        ? setInterval(loadCalibrationResults, 3000)
        : null;

    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [calibrationId, calibrationStatus?.status]);

  // Stream only new output from the active EN calibration.
  useEffect(() => {
    if (!calibrationId) {
      setCalibrationLog("");
      calibrationLogOffsetRef.current = 0;
      return;
    }

    let cancelled = false;

    async function loadCalibrationLog() {
      try {
        const response = await fetch(
          `${API_BASE}/api/calibration/${calibrationId}/log?offset=${calibrationLogOffsetRef.current}`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const chunk = await response.text();
        const newOffset = Number(
          response.headers.get("X-Log-Offset") ||
            calibrationLogOffsetRef.current
        );

        if (!cancelled && chunk && !logSelectionRef.current) {
          setCalibrationLog((previous) => {
            const updated = previous + chunk;
            return updated.slice(-100000);
          });
        }

        if (!logSelectionRef.current) {
          calibrationLogOffsetRef.current = newOffset;
        }
      } catch (error) {
        console.error("Could not read calibration log:", error);
      }
    }

    loadCalibrationLog();
    const timer = setInterval(loadCalibrationLog, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [calibrationId]);

  async function deleteJob(jobId) {
    const response = await fetch(
      `${API_BASE}/api/jobs/${jobId}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to delete job");
    }

    // Remove it immediately from the visible history.
    setJobs((prev) =>
      prev.filter((job) => job.job_id !== jobId)
    );

    // Clear selection if the deleted run was selected.
    if (selectedJobId === jobId) {
      setSelectedJobId(null);
    }

    // Remove any stale lock state for that job.
    setLockedJobs((prev) => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  }

  async function deleteCalibration(calibrationIdToDelete) {
    const response = await fetch(
      `${API_BASE}/api/calibration/${calibrationIdToDelete}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to delete calibration");
    }

    setCalibrations((prev) =>
      prev.filter(
        (calibration) =>
          calibration.calibration_id !== calibrationIdToDelete
      )
    );

    if (calibrationId === calibrationIdToDelete) {
      setCalibrationId(null);
      setCalibrationStatus(null);
      setCalibrationResults([]);
      setCalibrationLog("");
    }

    setLockedCalibrations((prev) => {
      const next = new Set(prev);
      next.delete(calibrationIdToDelete);
      return next;
    });
  }

  // Ask the backend to safely terminate the selected simulation.
  async function stopJob(jobId) {
    if (!jobId) {
      return;
    }

    const response = await fetch(
      `${API_BASE}/api/jobs/${jobId}/stop`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Could not stop simulation");
    }
  }

  return (
    <Paper
      sx={{
        p: 3,
        background: "background.paper",
        color: "text.primary",
      }}
    >
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Antibody Simulation
      </Typography>

      <Typography
        variant="body1"
        sx={{
          color: "text.secondary",
          mb: 2,
        }}
      >
        All-atom and Martini workflows for antibody and Fab simulations.
      </Typography>

      <Divider sx={{ mb: 2, borderColor: "rgba(255,255,255,0.08)" }} />

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems="stretch"
      >
        {/* LEFT: HISTORY */}
        <Box
          sx={{
            width: { xs: "100%", md: 390 },
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Run history
          </Typography>

          <Box
            sx={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 2,
              background: "#121015",
              p: 1,
              height: 700,
              overflowY: "auto",
              scrollbarColor: "#555 #121015",
              scrollbarWidth: "thin",
              "&::-webkit-scrollbar": {
                width: "8px",
              },
              "&::-webkit-scrollbar-track": {
                background: "#121015",
              },
              "&::-webkit-scrollbar-thumb": {
                background: "#555",
                borderRadius: "8px",
              },
              "&::-webkit-scrollbar-thumb:hover": {
                background: "#777",
              },
            }}
          >
          <Stack spacing={1}>
          {historyError && (
            <Typography
              variant="caption"
              sx={{ color: "error.main", p: 1 }}
            >
              History backend unavailable: {historyError}
            </Typography>
          )}

          {!historyError && jobs.length === 0 && calibrations.length === 0 && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary" }}
              >
                No runs yet
              </Typography>

              <Typography
                variant="caption"
                sx={{ color: "text.secondary" }}
              >
                AA, Martini, and EN calibrations will appear here.
              </Typography>
            </Box>
          )}

          {jobs.map((job) => {
            const shortId = job.job_id?.slice(0, 8) || "unknown";

            const runId =
              job.method === "martini"
                ? `M3-${shortId}`
                : `AA-${shortId}`;

            const methodDetail =
              job.method === "martini"
                ? job.model === "elastic"
                  ? `EN${job.elastic_force || ""}`
                  : "GōMartini"
                : null;

            return (
              <HistoryItem
                key={job.job_id}
                runId={runId}
                status={job.status}
                protein={job.protein || "Antibody"}
                methodDetail={methodDetail}
                duration={job.duration_ns}
                selected={selectedJobId === job.job_id}
                locked={lockedJobs.has(job.job_id)}
                onClick={() => setSelectedJobId(job.job_id)}
                onToggleLock={() => {
                  setLockedJobs((prev) => {
                    const next = new Set(prev);

                    if (next.has(job.job_id)) {
                      next.delete(job.job_id);
                    } else {
                      next.add(job.job_id);
                    }

                    return next;
                  });
                }}
                onDelete={() => deleteJob(job.job_id)}
              />
            );
          })}

          {calibrations.map((calibration) => {
            const shortId =
              calibration.calibration_id?.slice(0, 8) || "unknown";
            const aaShort =
              calibration.aa_job_id?.slice(0, 8) || "unknown";

            return (
              <HistoryItem
                key={`cal-${calibration.calibration_id}`}
                runId={`CAL-${shortId}`}
                status={calibration.status}
                protein={`AA-${aaShort}`}
                methodDetail={calibration.model === "go" ? "Gō calibration" : "EN calibration"}
                duration={calibration.duration_ns}
                selected={
                  mode === "calibration" &&
                  calibrationId === calibration.calibration_id
                }
                locked={lockedCalibrations.has(
                  calibration.calibration_id
                )}
                onClick={() => {
                  setSelectedJobId(null);
                  setMode("calibration");
                  setCalibrationId(calibration.calibration_id);

                  if (calibration.aa_job_id) {
                    setCalibrationAaJobId(calibration.aa_job_id);
                  }

                  if (calibration.duration_ns != null) {
                    setCalibrationDuration(
                      Number(calibration.duration_ns)
                    );
                  }

                  if (calibration.nt != null) {
                    setCalibrationThreads(
                      Number(calibration.nt)
                    );
                  }

                  if (calibration.parallel != null) {
                    setCalibrationParallel(
                      Number(calibration.parallel)
                    );
                  }

                  if (calibration.replicas != null) {
                    setCalibrationReplicas(Math.max(1, Number(calibration.replicas)));
                  }

                  const selectedModel = calibration.model === "go" ? "go" : "elastic";
                  setCalibrationModel(selectedModel);
                  if (selectedModel === "go") {
                    if (calibration.forces) setCalibrationGoEpsilons(calibration.forces);
                    if (calibration.lowers) setCalibrationGoLowers(calibration.lowers);
                    if (calibration.uppers) setCalibrationGoUppers(calibration.uppers);
                  } else {
                    if (calibration.forces) setCalibrationForces(calibration.forces);
                    if (calibration.lowers) setCalibrationLowers(calibration.lowers);
                    if (calibration.uppers) setCalibrationUppers(calibration.uppers);
                  }
                }}
                onToggleLock={() => {
                  setLockedCalibrations((prev) => {
                    const next = new Set(prev);

                    if (next.has(calibration.calibration_id)) {
                      next.delete(calibration.calibration_id);
                    } else {
                      next.add(calibration.calibration_id);
                    }

                    return next;
                  });
                }}
                onDelete={() =>
                  deleteCalibration(calibration.calibration_id)
                }
              />
            );
          })}
        </Stack>
          </Box>
        </Box>

        {/* RIGHT: WORKFLOW */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Simulation workflow
          </Typography>

          {/* AA / MARTINI CHOICE */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ mb: 3 }}
          >
            <WorkflowCard
              active={mode === "aa"}
              title="All-Atom"
              subtitle="CHARMM36m · Explicit solvent"
              onClick={() => setMode("aa")}
            />

            <WorkflowCard
              active={mode === "martini"}
              title="Martini"
              subtitle="Martini 3 · EN / Gō"
              onClick={() => setMode("martini")}
            />

            <WorkflowCard
              active={mode === "calibration"}
              title="Calibration"
              subtitle="Martini → AA dynamics"
              onClick={() => setMode("calibration")}
            />
          </Stack>

          <Divider sx={{ mb: 3, borderColor: "rgba(255,255,255,0.08)" }} />

          {mode === "aa" ? (
            <AllAtomPanel
              duration={aaDuration}
              setDuration={setAaDuration}
              proteinFile={proteinFile}
              setProteinFile={setProteinFile}
              onRun={createAAJob}
              saltConcentration={saltConcentration}
              setSaltConcentration={setSaltConcentration}
              temperature={temperature}
              setTemperature={setTemperature}
              cpuThreads={cpuThreads}
              setCpuThreads={setCpuThreads}
              onStop={() => stopJob(selectedJobId)}
              selectedJobStatus={
                jobs.find((job) => job.job_id === selectedJobId)?.status
              }
            />
          ) : mode === "martini" ? (
            <MartiniPanel
              duration={martiniDuration}
              setDuration={setMartiniDuration}
              model={martiniModel}
              setModel={setMartiniModel}
              elasticForce={elasticForce}
              setElasticForce={setElasticForce}
              elasticLower={elasticLower}
              setElasticLower={setElasticLower}
              elasticUpper={elasticUpper}
              setElasticUpper={setElasticUpper}
              goEpsilon={goEpsilon}
              setGoEpsilon={setGoEpsilon}
              goLower={goLower}
              setGoLower={setGoLower}
              goUpper={goUpper}
              setGoUpper={setGoUpper}
              proteinFile={proteinFile}
              setProteinFile={setProteinFile}
              temperature={temperature}
              setTemperature={setTemperature}
              cpuThreads={cpuThreads}
              setCpuThreads={setCpuThreads}
              onRun={createMartiniJob}
              onStop={() => stopJob(selectedJobId)}
              selectedJobStatus={
                jobs.find((job) => job.job_id === selectedJobId)?.status
              }
            />
          ) : (
            <CalibrationPanel
              calibrationId={calibrationId}
              jobs={jobs}
              calibrations={calibrations}
              aaJobId={calibrationAaJobId}
              setAaJobId={setCalibrationAaJobId}
              duration={calibrationDuration}
              setDuration={setCalibrationDuration}
              threads={calibrationThreads}
              setThreads={setCalibrationThreads}
              parallel={calibrationParallel}
              setParallel={setCalibrationParallel}
              replicas={calibrationReplicas}
              setReplicas={setCalibrationReplicas}
              model={calibrationModel}
              setModel={setCalibrationModel}
              goEpsilons={calibrationGoEpsilons}
              setGoEpsilons={setCalibrationGoEpsilons}
              goLowers={calibrationGoLowers}
              setGoLowers={setCalibrationGoLowers}
              goUppers={calibrationGoUppers}
              setGoUppers={setCalibrationGoUppers}
              forces={calibrationForces}
              setForces={setCalibrationForces}
              lowers={calibrationLowers}
              setLowers={setCalibrationLowers}
              uppers={calibrationUppers}
              setUppers={setCalibrationUppers}
              onRun={createCalibration}
              status={calibrationStatus}
              error={calibrationError}
              results={calibrationResults}
              resultsLoading={calibrationResultsLoading}
              resultsError={calibrationResultsError}
            />
          )}

        </Box>
      </Stack>
      {/* ---------------------------------------------------------
        FULL-WIDTH LIVE TERMINAL
      --------------------------------------------------------- */}
      <Stack spacing={0.25} sx={{ mb: 1 }}>
        <Typography variant="subtitle1">
          Live output
        </Typography>

        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            fontFamily: "monospace",
          }}
        >
          {mode === "calibration" && calibrationId
            ? `CAL-${calibrationId.slice(0, 8)}`
            : selectedJobId
              ? `${jobs.find((job) => job.job_id === selectedJobId)?.method === "martini" ? "M3" : "AA"}-${selectedJobId.slice(0, 8)}`
              : "No run selected"}
        </Typography>
      </Stack>

      <Box
        ref={logBoxRef}
        component="pre"
        onMouseDown={() => {
          // Freeze terminal updates while the user inspects/copies text.
          logSelectionRef.current = true;
        }}
        sx={{
          m: 0,
          p: 2,
          width: "100%",
          height: 420,
          overflowY: "auto",
          overflowX: "auto",
          borderRadius: 2,
          background: "#0b0b0d",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "#d6d6d8",
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          boxSizing: "border-box",
        }}
      >
        {mode === "calibration" && calibrationId
          ? calibrationLog || "Waiting for calibration output..."
          : selectedJobId
            ? liveLog || "Waiting for simulation output..."
            : "Select a simulation from the history to view its output."}
      </Box>
    </Paper>
  );
}


function WorkflowCard({
  active,
  title,
  subtitle,
  onClick,
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        flex: 1,
        p: 2.5,
        cursor: "pointer",
        borderRadius: 2,
        border: active
          ? "1px solid"
          : "1px solid rgba(255,255,255,0.10)",

        borderColor: active
          ? "primary.main"
          : "rgba(255,255,255,0.10)",

        background: active
          ? "rgba(85,169,159,0.10)"
          : "#151217",
        transition: "0.2s",
        "&:hover": {
          borderColor: active ? "primary.main" : "secondary.main",
          transform: "translateY(-1px)",
        },
      }}
    >
      <Typography
        variant="h6"
        sx={{
          color: active ? "primary.main" : "text.primary",
          fontWeight: 600,
        }}
      >
        {title}
      </Typography>

      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mt: 0.5,
        }}
      >
        {subtitle}
      </Typography>
    </Box>
  );
}


function HistoryItem({
  runId,
  status,
  protein,
  methodDetail,
  duration,
  selected,
  locked,
  onClick,
  onToggleLock,
  onDelete,
}) {
  const running = status === "running";
  const failed = status === "failed" || status === "error";

  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        cursor: "pointer",
        background: selected
          ? "rgba(85,169,159,0.10)"
          : "#1a171d",
        border: "1px solid",
        borderColor: selected
          ? "primary.main"
          : "transparent",
        transition: "0.15s",
        "&:hover": {
          background: selected
            ? "rgba(85,169,159,0.14)"
            : "#211d25",
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 9,
            height: 9,
            flexShrink: 0,
            borderRadius: "50%",
            background: failed
              ? "error.main"
              : running
                ? "secondary.main"
                : "success.main",
          }}
        />

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                fontFamily: "monospace",
              }}
            >
              {runId}
            </Typography>

            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                textTransform: "uppercase",
                color:
                  status === "error"
                    ? "error.main"
                    : status === "running"
                      ? "secondary.main"
                      : status === "done"
                        ? "success.main"
                        : "text.secondary",
              }}
            >
              {status || "unknown"}
            </Typography>
          </Stack>

          <Typography
            variant="caption"
            noWrap
            sx={{
              display: "block",
              color: "text.secondary",
            }}
          >
            {protein}
            {methodDetail ? ` · ${methodDetail}` : ""}
            {duration ? ` · ${duration} ns` : ""}
          </Typography>
        </Box>
        {/* Job protection / deletion */}
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock();
              }}
              sx={{
                minWidth: 32,
                px: 0.75,
                color: locked ? "success.main" : "text.secondary",
                borderColor: locked ? "success.main" : "#555",
              }}
            >
              {locked ? "🔒" : "🔓"}
            </Button>

            <Button
              size="small"
              color="error"
              disabled={locked}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              sx={{ minWidth: 32 }}
            >
              ✕
            </Button>
          </Stack>
      </Stack>
    </Box>
  );
}


function ProteinInput({ proteinFile, setProteinFile }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ sm: "center" }}
    >
      <Button
        variant="outlined"
        color="secondary"
        component="label"
      >
        Load antibody PDB

        <input
          hidden
          type="file"
          accept=".pdb,.ent"
          onChange={(e) =>
            setProteinFile(e.target.files?.[0] || null)
          }
        />
      </Button>

      <Typography
        variant="body2"
        sx={{ color: "text.secondary" }}
      >
        {proteinFile
          ? proteinFile.name
          : "No structure selected"}
      </Typography>
    </Stack>
  );
}


function AllAtomPanel({
  duration,
  setDuration,
  proteinFile,
  setProteinFile,
  onRun,
  saltConcentration,
  setSaltConcentration,
  temperature,
  setTemperature,
  cpuThreads,
  setCpuThreads,
  onStop,
  selectedJobStatus,
}) {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Structure
        </Typography>

        <ProteinInput
          proteinFile={proteinFile}
          setProteinFile={setProteinFile}
        />
        </Box>

      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          System
        </Typography>

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          flexWrap="wrap"
        >
          <TextField
            select
            label="Force field"
            value="charmm36m"
            size="small"
            sx={{ width: 180 }}
          >
            <MenuItem value="charmm36m">
              CHARMM36m
            </MenuItem>
          </TextField>

          <TextField
            select
            label="Water"
            value="tip3p"
            size="small"
            sx={{ width: 150 }}
          >
            <MenuItem value="tip3p">
              TIP3P
            </MenuItem>
          </TextField>

          <TextField
            label="NaCl (M)"
            type="text"
            value={saltConcentration}
            onChange={(e) => {
              // Accept either 0.15 or 0,15, but display a decimal point.
              const value = e.target.value.replace(",", ".");
              setSaltConcentration(value);
            }}
            size="small"
            sx={{ width: 130 }}
            inputProps={{
              inputMode: "decimal",
            }}
          />

          <TextField
            label="Temperature (K)"
            type="text"
            value={temperature}
            onChange={(e) => {
              const value = e.target.value.replace(",", ".");
              setTemperature(value);
            }}
            size="small"
            sx={{ width: 160 }}
            inputProps={{
              inputMode: "decimal",
            }}
          />

          <TextField
            label="CPU threads"
            type="number"
            value={cpuThreads}
            onChange={(e) =>
              setCpuThreads(
                Math.max(1, Math.floor(Number(e.target.value) || 1))
              )
            }
            size="small"
            sx={{ width: 150 }}
            inputProps={{ min: 1, step: 1 }}
          />
        </Stack>
      </Box>


      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Protocol
        </Typography>

        {/* Compact AA workflow summary. */}
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          flexWrap="wrap"
          alignItems="center"
        >
          {[
            "EM",
            "NVT",
            "NPT",
            "Free EQ",
            "Production",
          ].map((stage, index) => (
            <Box
              key={stage}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  px: 1.1,
                  py: 0.4,
                  borderRadius: 1,
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "text.secondary",
                  whiteSpace: "nowrap",
                  fontSize: "0.85rem",
                }}
              >
                {stage}
              </Typography>

              {index < 4 && (
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary" }}
                >
                  →
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
      >
        <TextField
          label="Production (ns)"
          type="number"
          value={duration}
          onChange={(e) =>
            setDuration(Number(e.target.value))
          }
          size="small"
          sx={{ width: 170 }}
        />

        <Button
          variant="contained"
          color="primary"
          onClick={onRun}
          disabled={!proteinFile}
        >
          Build + Run AA
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={onStop}
          disabled={
            selectedJobStatus !== "running" &&
            selectedJobStatus !== "queued"
          }
        >
          Stop
        </Button>
      </Stack>
    </Stack>
  );
}



function CalibrationPanel({
  calibrationId,
  jobs,
  calibrations,
  aaJobId,
  setAaJobId,
  duration,
  setDuration,
  threads,
  setThreads,
  parallel,
  setParallel,
  replicas,
  setReplicas,
  model,
  setModel,
  goEpsilons,
  setGoEpsilons,
  goLowers,
  setGoLowers,
  goUppers,
  setGoUppers,
  forces,
  setForces,
  lowers,
  setLowers,
  uppers,
  setUppers,
  onRun,
  status,
  error,
  results,
  resultsLoading,
  resultsError,
}) {
  const activeModel = status?.model === "go" ? "go" : "elastic";
  const parameterKeys = activeModel === "go"
    ? ["go_epsilon", "go_lower", "go_upper"]
    : ["elastic_force", "elastic_lower", "elastic_upper"];
  const parameterLabels = activeModel === "go" ? ["ε", "gl", "gu"] : ["ef", "el", "eu"];
  const completedAaJobs = jobs.filter(
    (job) => job.method === "aa" && job.status === "done"
  );

  const running = status?.status === "running";
  const runningCalibrationCount = (calibrations || []).filter(
    (calibration) => calibration.status === "running"
  ).length;
  const completed = status?.completed ?? 0;
  const total = status?.total ?? 0;
  const progress = Number(status?.progress_percent ?? 0);
  const requestedReplicas = Number(status?.replicas_requested ?? replicas ?? 1);
  const reusedRuns = Number(status?.reused ?? 0);

  const numericResults = (results || [])
    .map((row) => ({
      ...row,
      [parameterKeys[0]]: Number(row[parameterKeys[0]]),
      [parameterKeys[1]]: Number(row[parameterKeys[1]]),
      [parameterKeys[2]]: Number(row[parameterKeys[2]]),
      rmse_nm: Number(row.rmse_nm),
      pearson: Number(row.pearson),
      spearman: Number(row.spearman),
      score: Number(row.score),
      score_sd: Number(row.score_sd ?? 0),
      rmse_nm_sd: Number(row.rmse_nm_sd ?? 0),
      pearson_sd: Number(row.pearson_sd ?? 0),
      spearman_sd: Number(row.spearman_sd ?? 0),
      replicas: Number(row.replicas ?? 1),
    }))
    .filter((row) => parameterKeys.every((key) => Number.isFinite(row[key])) && Number.isFinite(row.score));

  const bestResult =
    numericResults.length > 0
      ? [...numericResults].sort((a, b) => a.score - b.score)[0]
      : null;

  const [sectionTab, setSectionTab] = useState("setup");
  const [analysisTab, setAnalysisTab] = useState("gp");
  const [sliceVariable, setSliceVariable] = useState("elastic_force");
  const [sliceForce, setSliceForce] = useState("");
  const [sliceLower, setSliceLower] = useState("");
  const [sliceUpper, setSliceUpper] = useState("");
  const [sliceMetric, setSliceMetric] = useState("score");

  useEffect(() => {
    setSliceVariable(parameterKeys[0]);
    setSliceForce("");
    setSliceLower("");
    setSliceUpper("");
  }, [calibrationId, activeModel]);

  useEffect(() => {
    if (!bestResult) return;
    setSliceForce(String(bestResult[parameterKeys[0]]));
    setSliceLower(String(bestResult[parameterKeys[1]]));
    setSliceUpper(String(bestResult[parameterKeys[2]]));
  }, [calibrationId, activeModel, bestResult?.[parameterKeys[0]], bestResult?.[parameterKeys[1]], bestResult?.[parameterKeys[2]]]);

  const uniqueValues = (field) =>
    [...new Set(numericResults.map((row) => row[field]))].sort((a, b) => a - b);

  const selectedForce = Number(sliceForce);
  const selectedLower = Number(sliceLower);
  const selectedUpper = Number(sliceUpper);
  const [first, lower, upper] = parameterKeys;
  const [firstLabel, lowerLabel, upperLabel] = parameterLabels;
  const sliceConfig = {
    [first]: {
      label: firstLabel,
      title: `${firstLabel} slice · ${lowerLabel}=${sliceLower}, ${upperLabel}=${sliceUpper}`,
      rows: numericResults.filter((row) => row[lower] === selectedLower && row[upper] === selectedUpper)
        .sort((a, b) => a[first] - b[first]),
    },
    [lower]: {
      label: lowerLabel,
      title: `${lowerLabel} slice · ${firstLabel}=${sliceForce}, ${upperLabel}=${sliceUpper}`,
      rows: numericResults.filter((row) => row[first] === selectedForce && row[upper] === selectedUpper)
        .sort((a, b) => a[lower] - b[lower]),
    },
    [upper]: {
      label: upperLabel,
      title: `${upperLabel} slice · ${firstLabel}=${sliceForce}, ${lowerLabel}=${sliceLower}`,
      rows: numericResults.filter((row) => row[first] === selectedForce && row[lower] === selectedLower)
        .sort((a, b) => a[upper] - b[upper]),
    },
  };

  async function runAndShowOverview() {
    await onRun();
    setSectionTab("overview");
  }

  return (
    <Stack spacing={2.25}>
      <Tabs
        value={sectionTab}
        onChange={(_, value) => setSectionTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <Tab value="setup" label="Setup" />
        <Tab value="overview" label="Overview" />
        <Tab value="analysis" label="Analysis" />
      </Tabs>

      {sectionTab === "setup" && (
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1.25 }}>
              AA reference
            </Typography>
            <TextField
              select
              label="Completed AA job"
              value={aaJobId}
              onChange={(e) => setAaJobId(e.target.value)}
              size="small"
              sx={{ minWidth: 340, maxWidth: "100%" }}
            >
              {completedAaJobs.map((job) => (
                <MenuItem key={job.job_id} value={job.job_id}>
                  {`AA-${job.job_id.slice(0, 8)} · ${job.protein || "Antibody"} · ${job.duration_ns} ns`}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1.25 }}>
              {model === "go" ? "GōMartini search" : "Elastic-network search"}
            </Typography>
            <Stack spacing={2}>
              <TextField select label="Calibration model" size="small" value={model}
                onChange={(e) => setModel(e.target.value)} sx={{ width: 230 }}>
                <MenuItem value="elastic">Elastic network (EN)</MenuItem>
                <MenuItem value="go">GōMartini</MenuItem>
              </TextField>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                flexWrap="wrap"
              >
                <TextField
                  label={model === "go" ? "Gō ε values (kJ/mol)" : "Force constants"}
                  value={model === "go" ? goEpsilons : forces}
                  onChange={(e) => model === "go" ? setGoEpsilons(e.target.value) : setForces(e.target.value)}
                  helperText={model === "go" ? "ε grid, comma-separated" : "ef grid, comma-separated"}
                  size="small"
                  sx={{ minWidth: 350 }}
                />
                <TextField
                  label="Lower cutoffs"
                  value={model === "go" ? goLowers : lowers}
                  onChange={(e) => model === "go" ? setGoLowers(e.target.value) : setLowers(e.target.value)}
                  helperText={model === "go" ? "gl (nm)" : "el (nm)"}
                  size="small"
                  sx={{ width: 180 }}
                />
                <TextField
                  label="Upper cutoffs"
                  value={model === "go" ? goUppers : uppers}
                  onChange={(e) => model === "go" ? setGoUppers(e.target.value) : setUppers(e.target.value)}
                  helperText={model === "go" ? "gu (nm)" : "eu (nm)"}
                  size="small"
                  sx={{ width: 190 }}
                />
              </Stack>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                flexWrap="wrap"
              >
                <TextField
                  label="Production (ns)"
                  type="number"
                  value={duration}
                  onChange={(e) =>
                    setDuration(Math.max(0.01, Number(e.target.value) || 0.01))
                  }
                  size="small"
                  sx={{ width: 190 }}
                />
                <TextField
                  label="Replicas / point"
                  type="number"
                  value={replicas}
                  onChange={(e) =>
                    setReplicas(
                      Math.max(1, Math.floor(Number(e.target.value) || 1))
                    )
                  }
                  inputProps={{ min: 1, step: 1 }}
                  helperText="Existing compatible replicas are reused"
                  size="small"
                  sx={{ width: 235 }}
                />
              </Stack>

              <Accordion
                disableGutters
                sx={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px !important",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary expandIcon={<span>▾</span>}>
                  <Typography variant="body2">Advanced execution</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                      label="Threads / job"
                      type="number"
                      value={threads}
                      onChange={(e) =>
                        setThreads(
                          Math.max(1, Math.floor(Number(e.target.value) || 1))
                        )
                      }
                      inputProps={{ min: 1, step: 1 }}
                      size="small"
                      sx={{ width: 160 }}
                    />
                    <TextField
                      label="Parallel jobs"
                      type="number"
                      value={parallel}
                      onChange={(e) =>
                        setParallel(
                          Math.max(1, Math.floor(Number(e.target.value) || 1))
                        )
                      }
                      inputProps={{ min: 1, step: 1 }}
                      size="small"
                      sx={{ width: 160 }}
                    />
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Box>

          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Search parameters are calibrated against the selected AA RMSF.
              Final {model === "go" ? "Gō" : "EN"} settings should still be validated independently.
            </Typography>
          </Box>

          <Stack spacing={0.75} alignItems="flex-start">
            {runningCalibrationCount > 0 && (
              <Typography variant="body2" sx={{ color: "warning.main" }}>
                {runningCalibrationCount} {runningCalibrationCount === 1 ? "calibration" : "calibrations"} currently running
              </Typography>
            )}

            <Button
              variant="contained"
              color="secondary"
              onClick={runAndShowOverview}
              disabled={!aaJobId}
              sx={{ minWidth: 190 }}
            >
              {runningCalibrationCount > 0
                ? `Run another ${model === "go" ? "Gō" : "EN"} calibration`
                : `Run ${model === "go" ? "Gō" : "EN"} Calibration`}
            </Button>
          </Stack>

          {error && (
            <Typography variant="body2" sx={{ color: "error.main" }}>
              {error}
            </Typography>
          )}
        </Stack>
      )}

      {sectionTab === "overview" && (
        <Stack spacing={2.25}>
          {!status && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Run or select a calibration to see its progress and ranking.
            </Typography>
          )}

          {status && (
            <>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  spacing={1}
                  sx={{ mb: 1.25 }}
                >
                  <Box>
                    <Typography variant="subtitle1">Current calibration</Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {completed} / {total} simulations complete
                      {reusedRuns > 0 ? ` · ${reusedRuns} reused` : ""}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      color:
                        status.status === "done"
                          ? "success.main"
                          : status.status === "failed"
                            ? "error.main"
                            : "warning.main",
                      textTransform: "uppercase",
                    }}
                  >
                    {status.status}
                  </Typography>
                </Stack>

                <Box
                  sx={{
                    height: 7,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      width: `${Math.max(0, Math.min(100, progress))}%`,
                      height: "100%",
                      background: "currentColor",
                      color: "secondary.main",
                      transition: "width 200ms ease",
                    }}
                  />
                </Box>
              </Box>

              {bestResult && (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Best observed parameter set
                  </Typography>
                  <Typography variant="h6" sx={{ mt: 0.25 }}>
                    {parameterLabels[0]} {bestResult[parameterKeys[0]]} · {parameterLabels[1]} {bestResult[parameterKeys[1]]} · {parameterLabels[2]} {bestResult[parameterKeys[2]]}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Score {bestResult.score.toFixed(4)}
                    {bestResult.replicas > 1
                      ? ` ± ${bestResult.score_sd.toFixed(4)}`
                      : ""}
                    {` · n=${bestResult.replicas}`}
                  </Typography>
                </Box>
              )}

              {status.top_results?.length > 0 && (
                <CalibrationTopCandidatesTable
                  rows={status.top_results}
                  requestedReplicas={requestedReplicas}
                  running={running}
                  model={activeModel}
                />
              )}
            </>
          )}
        </Stack>
      )}

      {sectionTab === "analysis" && (
        <Stack spacing={2}>
          <Tabs
            value={analysisTab}
            onChange={(_, value) => setAnalysisTab(value)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ minHeight: 38 }}
          >
            <Tab value="gp" label="GP Surface" sx={{ minHeight: 38 }} />
            <Tab value="slices" label="Slices" sx={{ minHeight: 38 }} />
            <Tab value="raw" label="Raw results" sx={{ minHeight: 38 }} />
          </Tabs>

          {resultsLoading && numericResults.length === 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Loading calibration results…
            </Typography>
          )}

          {resultsError && (
            <Typography variant="body2" sx={{ color: "error.main" }}>
              Could not load calibration results: {resultsError}
            </Typography>
          )}

          {analysisTab === "gp" && (
            <GaussianProcessSurface
              calibrationId={calibrationId}
              bestResult={bestResult}
              model={activeModel}
            />
          )}

          {analysisTab === "slices" && (
            <Stack spacing={2}>
              {numericResults.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  No completed calibration points yet.
                </Typography>
              ) : (
                <>
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    spacing={1.5}
                    flexWrap="wrap"
                  >
                    <TextField
                      select
                      label="Vary"
                      size="small"
                      value={sliceVariable}
                      onChange={(e) => setSliceVariable(e.target.value)}
                      sx={{ width: 160 }}
                    >
                      {parameterKeys.map((key, i) => <MenuItem key={key} value={key}>{parameterLabels[i]}</MenuItem>)}
                    </TextField>

                    <TextField
                      select
                      label={`Anchor ${firstLabel}`}
                      size="small"
                      value={sliceForce}
                      onChange={(e) => setSliceForce(e.target.value)}
                      sx={{ width: 145 }}
                    >
                      {uniqueValues(first).map((value) => (
                        <MenuItem key={value} value={String(value)}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label={`Anchor ${lowerLabel}`}
                      size="small"
                      value={sliceLower}
                      onChange={(e) => setSliceLower(e.target.value)}
                      sx={{ width: 145 }}
                    >
                      {uniqueValues(lower).map((value) => (
                        <MenuItem key={value} value={String(value)}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label={`Anchor ${upperLabel}`}
                      size="small"
                      value={sliceUpper}
                      onChange={(e) => setSliceUpper(e.target.value)}
                      sx={{ width: 145 }}
                    >
                      {uniqueValues(upper).map((value) => (
                        <MenuItem key={value} value={String(value)}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label="Metric"
                      size="small"
                      value={sliceMetric}
                      onChange={(e) => setSliceMetric(e.target.value)}
                      sx={{ width: 150 }}
                    >
                      <MenuItem value="score">Score</MenuItem>
                      <MenuItem value="rmse_nm">RMSE</MenuItem>
                      <MenuItem value="pearson">Pearson</MenuItem>
                      <MenuItem value="spearman">Spearman</MenuItem>
                    </TextField>
                  </Stack>

                  <CalibrationSlicePlot
                    title={sliceConfig[sliceVariable].title}
                    rows={sliceConfig[sliceVariable].rows}
                    varyingField={sliceVariable}
                    varyingLabel={sliceConfig[sliceVariable].label}
                    metric={sliceMetric}
                  />
                  <CalibrationSliceTable
                    title={sliceConfig[sliceVariable].title}
                    rows={sliceConfig[sliceVariable].rows}
                    varyingField={sliceVariable}
                    varyingLabel={sliceConfig[sliceVariable].label}
                  />
                </>
              )}
            </Stack>
          )}

          {analysisTab === "raw" && (
            <CalibrationResultsTable rows={numericResults} model={activeModel} />
          )}
        </Stack>
      )}
    </Stack>
  );
}

function CalibrationTopCandidatesTable({ rows, requestedReplicas, running, model }) {
  const keys = model === "go" ? ["go_epsilon", "go_lower", "go_upper"] : ["elastic_force", "elastic_lower", "elastic_upper"];
  const labels = model === "go" ? ["ε", "gl", "gu"] : ["ef", "el", "eu"];
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {running ? "Best so far" : "Top candidates"}
      </Typography>
      <Box
        sx={{
          overflowX: "auto",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 2,
        }}
      >
        <Box
          component="table"
          sx={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            "& th, & td": {
              px: 1.25,
              py: 1,
              textAlign: "right",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              whiteSpace: "nowrap",
            },
            "& th:first-of-type, & td:first-of-type": { textAlign: "left" },
          }}
        >
          <thead>
            <tr>
              <th>Rank</th>{labels.map((label) => <th key={label}>{label}</th>)}<th>Replicas</th>
              <th>RMSE (nm)</th><th>Pearson</th><th>Spearman</th><th>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={keys.map((key) => row[key]).join("-")}>
                <td>{row.rank}</td>
                {keys.map((key) => <td key={key}>{row[key]}</td>)}
                <td>{row.replicas ?? 1} / {requestedReplicas}</td>
                <td>{formatCalibrationMetric(row.rmse_nm, row.rmse_nm_sd, row.replicas, 4)}</td>
                <td>{formatCalibrationMetric(row.pearson, row.pearson_sd, row.replicas, 3)}</td>
                <td>{formatCalibrationMetric(row.spearman, row.spearman_sd, row.replicas, 3)}</td>
                <td>{formatCalibrationMetric(row.score, row.score_sd, row.replicas, 4)}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      {running && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.75 }}>
          Rankings use completed replicas only and remain provisional while the calibration is running.
        </Typography>
      )}
    </Box>
  );
}

function formatCalibrationMetric(value, sd, replicas, decimals) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const base = number.toFixed(decimals);
  const spread = Number(sd);
  return Number(replicas ?? 1) > 1 && Number.isFinite(spread)
    ? `${base} ± ${spread.toFixed(decimals)}`
    : base;
}

function GaussianProcessSurface({ calibrationId, bestResult, model }) {
  const isGo = model === "go";
  const keys = isGo ? ["go_epsilon", "go_lower", "go_upper"] : ["elastic_force", "elastic_lower", "elastic_upper"];
  const labels = isGo ? ["ε", "gl", "gu"] : ["ef", "el", "eu"];
  const planeOptions = {
    "ef-el": { label: `${labels[0]} × ${labels[1]} · fix ${labels[2]}`, x: keys[0], y: keys[1], fixed: keys[2] },
    "ef-eu": { label: `${labels[0]} × ${labels[2]} · fix ${labels[1]}`, x: keys[0], y: keys[2], fixed: keys[1] },
    "el-eu": { label: `${labels[1]} × ${labels[2]} · fix ${labels[0]}`, x: keys[1], y: keys[2], fixed: keys[0] },
  };
  const parameterLabels = Object.fromEntries(keys.map((key, i) => [key, labels[i]]));

  const [plane, setPlane] = useState("ef-el");
  const [metric, setMetric] = useState("score");
  const [display, setDisplay] = useState("mean");
  const [fixedValue, setFixedValue] = useState("");
  const [gpData, setGpData] = useState(null);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState(null);

  const config = planeOptions[plane];
  const bestFixedValue = bestResult?.[config.fixed];

  useEffect(() => {
    if (bestFixedValue != null && Number.isFinite(Number(bestFixedValue))) {
      setFixedValue(String(bestFixedValue));
    }
  }, [calibrationId, plane, config.fixed, bestFixedValue]);

  useEffect(() => {
    setGpData(null);
    if (!calibrationId || fixedValue === "") return;
    let cancelled = false;

    async function loadGp() {
      setGpLoading(true);
      setGpError(null);
      try {
        const params = new URLSearchParams({
          x_param: config.x,
          y_param: config.y,
          fixed_param: config.fixed,
          fixed_value: String(fixedValue),
          metric,
          resolution: "30",
        });
        const response = await fetch(
          `${API_BASE}/api/calibration/${calibrationId}/gp?${params.toString()}`
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `GP HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!cancelled) setGpData(data);
      } catch (err) {
        if (!cancelled) {
          setGpData(null);
          setGpError(err.message);
        }
      } finally {
        if (!cancelled) setGpLoading(false);
      }
    }

    loadGp();
    return () => { cancelled = true; };
  }, [calibrationId, plane, metric, fixedValue, config.x, config.y, config.fixed]);

  const fixedChoices = gpData?.parameter_values?.[config.fixed] || [];
  const predicted = gpData?.predicted_best;
  const globalBest = gpData?.global_best;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle1">Gaussian-process response surface</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Pools compatible calibration history, deduplicates reused trajectories, and uses replica variability as observation noise.
        </Typography>
      </Box>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} flexWrap="wrap">
        <TextField
          select label="Plane" size="small" value={plane}
          onChange={(e) => setPlane(e.target.value)} sx={{ width: 190 }}
        >
          {Object.entries(planeOptions).map(([key, option]) => (
            <MenuItem key={key} value={key}>{option.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          select label="Metric" size="small" value={metric}
          onChange={(e) => setMetric(e.target.value)} sx={{ width: 150 }}
        >
          <MenuItem value="score">Score</MenuItem>
          <MenuItem value="rmse_nm">RMSE</MenuItem>
          <MenuItem value="pearson">Pearson</MenuItem>
          <MenuItem value="spearman">Spearman</MenuItem>
        </TextField>
        <TextField
          label={`Fixed ${parameterLabels[config.fixed]}`}
          size="small"
          type="number"
          value={fixedValue}
          onChange={(e) => setFixedValue(e.target.value)}
          sx={{ width: 160 }}
          helperText={fixedChoices.length > 0 ? `Observed: ${fixedChoices.join(", ")}` : "Continuous value"}
        />
        <TextField
          select label="Show" size="small" value={display}
          onChange={(e) => setDisplay(e.target.value)} sx={{ width: 150 }}
        >
          <MenuItem value="mean">Predicted mean</MenuItem>
          <MenuItem value="std">Uncertainty</MenuItem>
        </TextField>
      </Stack>

      {gpLoading && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Fitting Gaussian Process…
        </Typography>
      )}
      {gpError && (
        <Box sx={{ p: 1.5, borderRadius: 1.5, border: "1px solid rgba(244,67,54,0.35)" }}>
          <Typography variant="body2" sx={{ color: "error.main" }}>
            GP analysis unavailable: {gpError}
          </Typography>
        </Box>
      )}

      {gpData && !gpLoading && (
        <>
          {globalBest && (
            <Box
              sx={{
                p: 2,
                border: "1px solid",
                borderColor: "primary.main",
                borderRadius: 2,
                background: "rgba(85,169,159,0.08)",
              }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1.5}
                justifyContent="space-between"
                alignItems={{ md: "center" }}
              >
                <Box>
                  <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 700 }}>
                    {globalBest.objective === "maximum" ? "Global GP maximum" : "Global GP minimum"}
                  </Typography>
                  <Typography variant="h6" sx={{ mt: 0.25 }}>
                    {keys.map((key, i) => `${labels[i]}=${Number(globalBest[key]).toFixed(i === 0 && !isGo ? 0 : 3)}`).join(" · ")}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {metric} = {Number(globalBest.mean).toFixed(4)} ± {Number(globalBest.std).toFixed(4)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Optimized in all three {isGo ? "Gō" : "EN"} dimensions, constrained to the sampled parameter ranges.
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    setFixedValue(String(globalBest[config.fixed]))
                  }
                  sx={{ alignSelf: { xs: "flex-start", md: "center" }, whiteSpace: "nowrap" }}
                >
                  Show optimum plane
                </Button>
              </Stack>
            </Box>
          )}

          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <Box sx={{ p: 1.5, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2, flex: 1 }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Training data</Typography>
              <Typography variant="body1">{gpData.training_points} parameter sets · {gpData.training_trajectories} unique trajectories</Typography>
            </Box>
            {predicted && (
              <Box sx={{ p: 1.5, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2, flex: 1 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>Best predicted point on this plane</Typography>
                <Typography variant="body1">
                  {parameterLabels[config.x]}={Number(predicted[config.x]).toFixed(config.x === keys[0] && !isGo ? 0 : 3)} · {parameterLabels[config.y]}={Number(predicted[config.y]).toFixed(config.y === keys[0] && !isGo ? 0 : 3)}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {metric} = {Number(predicted.mean).toFixed(4)} ± {Number(predicted.std).toFixed(4)}
                </Typography>
              </Box>
            )}
          </Stack>

          <GpHeatmap
            data={gpData.surface}
            observed={gpData.observed}
            predicted={gpData.predicted_best}
            xLabel={parameterLabels[config.x]}
            yLabel={parameterLabels[config.y]}
            xField={config.x}
            yField={config.y}
            display={display}
          />

          <Box sx={{ p: 1.5, borderRadius: 2, background: "rgba(255,255,255,0.02)" }}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
              Relative parameter sensitivity
            </Typography>
            {(() => {
              const normalizedLengthScale = (param) => {
                const raw = Number(gpData.length_scales?.[param]);
                const min = Number(gpData.parameter_bounds?.[param]?.min);
                const max = Number(gpData.parameter_bounds?.[param]?.max);
                const exploredRange = max - min;
                return Number.isFinite(raw) && Number.isFinite(exploredRange) && exploredRange > 0
                  ? raw / exploredRange
                  : NaN;
              };

              const normalized = keys.map(normalizedLengthScale);
              const formatNormalized = (value) =>
                Number.isFinite(value) ? value.toFixed(2) : "—";
              return (
                <>
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                    {labels.map((label, i) => `${label} ${formatNormalized(normalized[i])}`).join(" · ")}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
                    Normalized length scale = GP length scale / explored parameter range. Smaller values mean greater sensitivity.
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.75, opacity: 0.8 }}>
                    Raw GP length scales: {keys.map((key, i) => `${labels[i]} ${Number(gpData.length_scales[key]).toFixed(i === 0 && !isGo ? 1 : 4)}`).join(" · ")}
                  </Typography>
                </>
              );
            })()}
          </Box>
        </>
      )}
    </Stack>
  );
}

function GpHeatmap({ data, observed, predicted, xLabel, yLabel, xField, yField, display }) {
  if (!data?.length) return null;

  const xValues = [...new Set(data.map((point) => Number(point.x)))].sort((a, b) => a - b);
  const yValues = [...new Set(data.map((point) => Number(point.y)))].sort((a, b) => b - a);
  const values = data.map((point) => Number(display === "std" ? point.std : point.mean));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  const byCoordinate = new Map(
    data.map((point) => [`${Number(point.x)}|${Number(point.y)}`, point])
  );

  function heatColor(value) {
    const t = Math.max(0, Math.min(1, (value - minValue) / range));
    const hue = 220 - 170 * t;
    const light = 28 + 22 * t;
    return `hsl(${hue} 68% ${light}%)`;
  }

  function xPercent(value) {
    return xMax === xMin ? 50 : ((value - xMin) / (xMax - xMin)) * 100;
  }
  function yPercent(value) {
    return yMax === yMin ? 50 : ((yMax - value) / (yMax - yMin)) * 100;
  }

  function axisTicks(min, max, label, count = 6) {
    if (max === min) return [min];

    // Force-constant axes use fixed 100-unit intervals so labels are
    // scientifically readable (100, 200, 300, ...), rather than
    // arbitrary fractions of the displayed ef range.
    if (label === "ef") {
      const first = Math.ceil(min / 100) * 100;
      const last = Math.floor(max / 100) * 100;
      const ticks = [];

      for (let value = first; value <= last; value += 100) {
        ticks.push(value);
      }

      return ticks.length > 0 ? ticks : [min, max];
    }

    return Array.from({ length: count }, (_, index) =>
      min + ((max - min) * index) / (count - 1)
    );
  }

  function formatAxisValue(value, label) {
    if (label === "ef") return String(Math.round(value));
    return Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  const xTicks = axisTicks(xMin, xMax, xLabel);
  const yTicks = axisTicks(yMin, yMax, yLabel);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
        <Typography variant="subtitle2">
          {display === "std" ? "Predictive uncertainty" : "Predicted response"}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          ● observed · ★ predicted optimum
        </Typography>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "auto auto minmax(0, 1fr)",
          gridTemplateRows: "minmax(420px, 1fr) auto auto",
          columnGap: 0.75,
          rowGap: 0.5,
          alignItems: "stretch",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            gridColumn: 1,
            gridRow: 1,
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            color: "text.secondary",
            alignSelf: "center",
          }}
        >
          {yLabel}
        </Typography>

        <Box
          sx={{
            gridColumn: 2,
            gridRow: 1,
            position: "relative",
            width: 46,
            minHeight: 420,
          }}
        >
          {yTicks.map((tick) => (
            <Typography
              key={`ytick-${tick}`}
              variant="caption"
              sx={{
                position: "absolute",
                right: 0,
                top: `${yPercent(tick)}%`,
                transform: "translateY(-50%)",
                color: "text.secondary",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              {formatAxisValue(tick, yLabel)}
            </Typography>
          ))}
        </Box>

        <Box
          sx={{
            gridColumn: 3,
            gridRow: 1,
            position: "relative",
            minHeight: 420,
            display: "grid",
            gridTemplateColumns: `repeat(${xValues.length}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${yValues.length}, minmax(0, 1fr))`,
            overflow: "hidden",
            borderRadius: 2,
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {yValues.flatMap((y) =>
            xValues.map((x) => {
              const point = byCoordinate.get(`${x}|${y}`);
              const value = Number(display === "std" ? point?.std : point?.mean);
              return (
                <Box
                  key={`${x}-${y}`}
                  title={`${xLabel}=${x.toFixed(4)}, ${yLabel}=${y.toFixed(4)}, ${display}=${value.toFixed(5)}`}
                  sx={{ background: heatColor(value), minWidth: 0, minHeight: 0 }}
                />
              );
            })
          )}

          {(observed || []).map((point, index) => (
            <Box
              key={`obs-${index}`}
              title={`Observed: ${xLabel}=${point.x}, ${yLabel}=${point.y}, value=${Number(point.value).toFixed(5)} ± ${Number(point.sd || 0).toFixed(5)}, n=${point.replicas}`}
              sx={{
                position: "absolute",
                left: `${xPercent(Number(point.x))}%`,
                top: `${yPercent(Number(point.y))}%`,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#fff",
                border: "2px solid #111",
                transform: "translate(-50%, -50%)",
                zIndex: 3,
              }}
            />
          ))}

          {predicted && (
            <Box
              title="Best predicted point on this plane"
              sx={{
                position: "absolute",
                left: `${xPercent(Number(predicted[xField]))}%`,
                top: `${yPercent(Number(predicted[yField]))}%`,
                transform: "translate(-50%, -55%)",
                color: "#fff",
                textShadow: "0 1px 3px #000",
                fontSize: 20,
                lineHeight: 1,
                zIndex: 4,
              }}
            >
              ★
            </Box>
          )}
        </Box>

        <Box
          sx={{
            gridColumn: 3,
            gridRow: 2,
            position: "relative",
            height: 22,
          }}
        >
          {xTicks.map((tick) => (
            <Typography
              key={`xtick-${tick}`}
              variant="caption"
              sx={{
                position: "absolute",
                left: `${xPercent(tick)}%`,
                transform: "translateX(-50%)",
                color: "text.secondary",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              {formatAxisValue(tick, xLabel)}
            </Typography>
          ))}
        </Box>

        <Typography
          variant="caption"
          sx={{
            gridColumn: 3,
            gridRow: 3,
            color: "text.secondary",
            textAlign: "center",
          }}
        >
          {xLabel} · scale {minValue.toFixed(4)} → {maxValue.toFixed(4)}
        </Typography>
      </Box>
    </Box>
  );
}

function CalibrationResultsTable({ rows, model }) {
  const keys = model === "go" ? ["go_epsilon", "go_lower", "go_upper"] : ["elastic_force", "elastic_lower", "elastic_upper"];
  const labels = model === "go" ? ["ε", "gl", "gu"] : ["ef", "el", "eu"];
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  if (!sorted.length) {
    return <Typography variant="body2" sx={{ color: "text.secondary" }}>No completed results yet.</Typography>;
  }
  return (
    <Box sx={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2 }}>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13, "& th, & td": { px: 1.25, py: 1, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" } }}>
        <thead><tr>{labels.map((label) => <th key={label}>{label}</th>)}<th>n</th><th>RMSE</th><th>Pearson</th><th>Spearman</th><th>Score</th></tr></thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={keys.map((key) => row[key]).join("-")}>
              {keys.map((key) => <td key={key}>{row[key]}</td>)}<td>{row.replicas}</td>
              <td>{formatCalibrationMetric(row.rmse_nm, row.rmse_nm_sd, row.replicas, 4)}</td>
              <td>{formatCalibrationMetric(row.pearson, row.pearson_sd, row.replicas, 3)}</td>
              <td>{formatCalibrationMetric(row.spearman, row.spearman_sd, row.replicas, 3)}</td>
              <td>{formatCalibrationMetric(row.score, row.score_sd, row.replicas, 4)}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function CalibrationSlicePlot({ title, rows, varyingField, varyingLabel, metric }) {
  const metricConfig = {
    score: { label: "Score", decimals: 4, best: "min" },
    rmse_nm: { label: "RMSE (nm)", decimals: 4, best: "min" },
    pearson: { label: "Pearson", decimals: 3, best: "max" },
    spearman: { label: "Spearman", decimals: 3, best: "max" },
  };
  const config = metricConfig[metric] || metricConfig.score;
  const data = rows
    .map((row) => ({ x: Number(row[varyingField]), y: Number(row[metric]), row }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!data.length) return null;
  const best = [...data].sort((a, b) => config.best === "min" ? a.y - b.y : b.y - a.y)[0];

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <Box sx={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, left: 5, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} label={{ value: varyingLabel, position: "insideBottom", offset: -5 }} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(value) => Number(value).toFixed(config.decimals)} width={72} />
            <Tooltip formatter={(value) => [Number(value).toFixed(config.decimals), config.label]} labelFormatter={(value) => `${varyingLabel}=${value}`} />
            <Line type="monotone" dataKey="y" stroke="currentColor" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            {best && <ReferenceDot x={best.x} y={best.y} r={6} fill="currentColor" stroke="none" />}
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}

function CalibrationSliceTable({ title, rows, varyingField, varyingLabel }) {
  if (!rows.length) return null;
  const bestScore = Math.min(...rows.map((row) => Number(row.score)));
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{title}</Typography>
      <Box sx={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2 }}>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13, "& th, & td": { px: 1.25, py: 1, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }, "& th:first-of-type, & td:first-of-type": { textAlign: "left" } }}>
          <thead><tr><th>{varyingLabel}</th><th>RMSE (nm)</th><th>Pearson</th><th>Spearman</th><th>Score</th><th>n</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const isBest = Number(row.score) === bestScore;
              return (
                <tr key={row[varyingField]}>
                  <td>{row[varyingField]}{isBest ? " ★" : ""}</td>
                  <td>{formatCalibrationMetric(row.rmse_nm, row.rmse_nm_sd, row.replicas, 4)}</td>
                  <td>{formatCalibrationMetric(row.pearson, row.pearson_sd, row.replicas, 3)}</td>
                  <td>{formatCalibrationMetric(row.spearman, row.spearman_sd, row.replicas, 3)}</td>
                  <td>{formatCalibrationMetric(row.score, row.score_sd, row.replicas, 4)}</td>
                  <td>{row.replicas}</td>
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>
    </Box>
  );
}


function MartiniPanel({
  duration,
  setDuration,
  model,
  setModel,
  elasticForce,
  setElasticForce,
  elasticLower,
  setElasticLower,
  elasticUpper,
  setElasticUpper,
  goEpsilon,
  setGoEpsilon,
  goLower,
  setGoLower,
  goUpper,
  setGoUpper,
  proteinFile,
  setProteinFile,
  temperature,
  setTemperature,
  cpuThreads,
  setCpuThreads,
  onRun,
  onStop,
  selectedJobStatus,
}) {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Structure
        </Typography>

        <ProteinInput
          proteinFile={proteinFile}
          setProteinFile={setProteinFile}
        />
      </Box>

      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

      <Box>
        <Typography variant="subtitle1">
          Structural model
        </Typography>

        <RadioGroup
          row
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <FormControlLabel
            value="elastic"
            control={<Radio />}
            label="Elastic Network"
          />

          <FormControlLabel
            value="go"
            control={<Radio />}
            label="GōMartini"
          />
        </RadioGroup>
      </Box>

      {model === "elastic" && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Elastic network parameters
          </Typography>

          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
          >
            <TextField
              label="Force constant"
              type="number"
              value={elasticForce}
              onChange={(e) =>
                setElasticForce(Number(e.target.value))
              }
              helperText="kJ mol⁻¹ nm⁻²"
              size="small"
              sx={{ width: 180 }}
            />

            <TextField
              label="Lower cutoff"
              type="number"
              value={elasticLower}
              onChange={(e) =>
                setElasticLower(Number(e.target.value))
              }
              helperText="nm"
              size="small"
              sx={{ width: 150 }}
            />

            <TextField
              label="Upper cutoff"
              type="number"
              value={elasticUpper}
              onChange={(e) =>
                setElasticUpper(Number(e.target.value))
              }
              helperText="nm"
              size="small"
              sx={{ width: 150 }}
            />
          </Stack>
        </Box>
      )}

      {model === "go" && (
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            background: "rgba(32,213,194,0.06)",
            border: "1px solid rgba(32,213,194,0.25)",
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            GōMartini parameters
          </Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField label="Contact strength (ε)" type="number" value={goEpsilon}
              onChange={(e) => setGoEpsilon(Number(e.target.value))}
              helperText="kJ/mol" size="small" sx={{ width: 190 }}
              inputProps={{ min: 0.001, step: 0.1 }} />
            <TextField label="Lower cutoff" type="number" value={goLower}
              onChange={(e) => setGoLower(Number(e.target.value))}
              helperText="nm" size="small" sx={{ width: 150 }}
              inputProps={{ min: 0.001, step: 0.1 }} />
            <TextField label="Upper cutoff" type="number" value={goUpper}
              onChange={(e) => setGoUpper(Number(e.target.value))}
              helperText="nm" size="small" sx={{ width: 150 }}
              inputProps={{ min: 0.001, step: 0.1 }} />
          </Stack>
        </Box>
      )}

      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          Environment
        </Typography>

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
        >
          <TextField
            label="NaCl (M)"
            value={0.15}
            size="small"
            sx={{ width: 130 }}
          />

          <TextField
            label="Temperature (K)"
            type="text"
            value={temperature}
            onChange={(e) => {
              const value = e.target.value.replace(",", ".");
              setTemperature(value);
            }}
            size="small"
            sx={{ width: 160 }}
            inputProps={{
              inputMode: "decimal",
            }}
          />

          <TextField
            label="Production (ns)"
            type="number"
            value={duration}
            onChange={(e) =>
              setDuration(Number(e.target.value))
            }
            size="small"
            sx={{ width: 170 }}
          />

          <TextField
            label="CPU threads"
            type="number"
            value={cpuThreads}
            onChange={(e) =>
              setCpuThreads(
                Math.max(1, Math.floor(Number(e.target.value) || 1))
              )
            }
            size="small"
            sx={{ width: 150 }}
            inputProps={{ min: 1, step: 1 }}
          />
        </Stack>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
      >
        <Button
          variant="contained"
          color="secondary"
          onClick={onRun}
          disabled={!proteinFile}
          sx={{
            minWidth: 180,
          }}
        >
          Build + Run Martini
        </Button>

        <Button
          variant="outlined"
          color="error"
          onClick={onStop}
          disabled={
            selectedJobStatus !== "running" &&
            selectedJobStatus !== "queued"
          }
        >
          Stop
        </Button>
      </Stack>
    </Stack>
  );
}