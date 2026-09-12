import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

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

  // Refresh the simulation history every second.
  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      try {
        const response = await fetch(
          `${API_BASE}/api/jobs?limit=50`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!cancelled) {
          setJobs(data);
          setHistoryError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryError(error.message);
        }
      }
    }

    loadJobs();

    const timer = setInterval(loadJobs, 1000);

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

  const [proteinFile, setProteinFile] = useState(null);

  const [saltConcentration, setSaltConcentration] = useState("0.15");
  const [temperature, setTemperature] = useState("310");
  const [cpuThreads, setCpuThreads] = useState(8);

  const [calibrationAaJobId, setCalibrationAaJobId] = useState("");
  const [calibrationDuration, setCalibrationDuration] = useState(10);
  const [calibrationThreads, setCalibrationThreads] = useState(4);
  const [calibrationParallel, setCalibrationParallel] = useState(2);
  const [calibrationForces, setCalibrationForces] =
    useState("100,200,300,400,500,600,700,800");
  const [calibrationLowers, setCalibrationLowers] = useState("0.4,0.5");
  const [calibrationUppers, setCalibrationUppers] = useState("0.7,0.8,0.9");

  const [calibrationId, setCalibrationId] = useState(null);
  const [calibrationStatus, setCalibrationStatus] = useState(null);
  const [calibrationError, setCalibrationError] = useState(null);

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
    form.append("elastic_force", elasticForce);
    form.append("elastic_lower", elasticLower);
    form.append("elastic_upper", elasticUpper);

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
    form.append("forces", calibrationForces);
    form.append("lowers", calibrationLowers);
    form.append("uppers", calibrationUppers);

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
            Simulation history
          </Typography>

          <Box
            sx={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 2,
              background: "#121015",
              p: 1,
              minHeight: 530,
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

          {!historyError && jobs.length === 0 && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary" }}
              >
                No simulations yet
              </Typography>

              <Typography
                variant="caption"
                sx={{ color: "text.secondary" }}
              >
                Your AA and Martini runs will appear here.
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
              title="EN Calibration"
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
              jobs={jobs}
              aaJobId={calibrationAaJobId}
              setAaJobId={setCalibrationAaJobId}
              duration={calibrationDuration}
              setDuration={setCalibrationDuration}
              threads={calibrationThreads}
              setThreads={setCalibrationThreads}
              parallel={calibrationParallel}
              setParallel={setCalibrationParallel}
              forces={calibrationForces}
              setForces={setCalibrationForces}
              lowers={calibrationLowers}
              setLowers={setCalibrationLowers}
              uppers={calibrationUppers}
              setUppers={setCalibrationUppers}
              onRun={createCalibration}
              status={calibrationStatus}
              error={calibrationError}
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
  jobs,
  aaJobId,
  setAaJobId,
  duration,
  setDuration,
  threads,
  setThreads,
  parallel,
  setParallel,
  forces,
  setForces,
  lowers,
  setLowers,
  uppers,
  setUppers,
  onRun,
  status,
  error,
}) {
  const completedAaJobs = jobs.filter(
    (job) =>
      job.method === "aa" &&
      job.status === "done"
  );

  const running = status?.status === "running";
  const completed = status?.completed ?? 0;
  const total = status?.total ?? 0;
  const progress = Number(status?.progress_percent ?? 0);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          AA reference
        </Typography>

        <TextField
          select
          label="Completed AA job"
          value={aaJobId}
          onChange={(e) => setAaJobId(e.target.value)}
          size="small"
          sx={{ minWidth: 340 }}
        >
          {completedAaJobs.map((job) => (
            <MenuItem
              key={job.job_id}
              value={job.job_id}
            >
              {`AA-${job.job_id.slice(0, 8)} · ${job.protein || "Antibody"} · ${job.duration_ns} ns`}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          Elastic-network grid
        </Typography>

        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            flexWrap="wrap"
          >
            <TextField
              label="Force constants"
              value={forces}
              onChange={(e) => setForces(e.target.value)}
              helperText="ef grid, comma-separated"
              size="small"
              sx={{ minWidth: 350 }}
            />

            <TextField
              label="Lower cutoffs"
              value={lowers}
              onChange={(e) => setLowers(e.target.value)}
              helperText="el (nm)"
              size="small"
              sx={{ width: 180 }}
            />

            <TextField
              label="Upper cutoffs"
              value={uppers}
              onChange={(e) => setUppers(e.target.value)}
              helperText="eu (nm)"
              size="small"
              sx={{ width: 190 }}
            />
          </Stack>

          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            flexWrap="wrap"
          >
            <TextField
              label="Candidate production (ns)"
              type="number"
              value={duration}
              onChange={(e) =>
                setDuration(Math.max(0.01, Number(e.target.value) || 0.01))
              }
              size="small"
              sx={{ width: 210 }}
            />

            <TextField
              label="Threads / job"
              type="number"
              value={threads}
              onChange={(e) =>
                setThreads(Math.max(1, Math.floor(Number(e.target.value) || 1)))
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
                setParallel(Math.max(1, Math.floor(Number(e.target.value) || 1)))
              }
              inputProps={{ min: 1, step: 1 }}
              size="small"
              sx={{ width: 160 }}
            />
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          p: 2,
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Calibration/search against the selected AA reference. Parameters
          selected here still require independent validation.
        </Typography>
      </Box>

      <Button
        variant="contained"
        color="secondary"
        onClick={onRun}
        disabled={!aaJobId || running}
        sx={{ alignSelf: "flex-start", minWidth: 190 }}
      >
        {running ? "Calibration running…" : "Run EN Calibration"}
      </Button>

      {error && (
        <Typography variant="body2" sx={{ color: "error.main" }}>
          {error}
        </Typography>
      )}

      {status && (
        <>
          <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

          <Box>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle1">
                Calibration status
              </Typography>

              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color:
                    status.status === "done"
                      ? "success.main"
                      : status.status === "failed"
                        ? "error.main"
                        : "secondary.main",
                }}
              >
                {status.status}
              </Typography>
            </Stack>

            <Typography variant="body2" sx={{ mb: 1 }}>
              {completed} / {total || "?"} candidates complete
              {total ? ` · ${progress.toFixed(1)}%` : ""}
            </Typography>

            <Box
              sx={{
                width: "100%",
                height: 10,
                borderRadius: 999,
                overflow: "hidden",
                background: "rgba(255,255,255,0.08)",
                mb: 1.5,
              }}
            >
              <Box
                sx={{
                  width: `${Math.min(100, Math.max(0, progress))}%`,
                  height: "100%",
                  background: "currentColor",
                  color:
                    status.status === "done"
                      ? "success.main"
                      : status.status === "failed"
                        ? "error.main"
                        : "secondary.main",
                  transition: "width 0.3s ease",
                }}
              />
            </Box>

            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Successful: {status.successful ?? 0}
              {" · "}
              Failed: {status.failed ?? 0}
            </Typography>
          </Box>

          {status.top_results?.length > 0 && (
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {status.status === "done" ? "Top candidates" : "Best so far"}
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
                    "& th:first-of-type, & td:first-of-type": {
                      textAlign: "left",
                    },
                  }}
                >
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>ef</th>
                      <th>el</th>
                      <th>eu</th>
                      <th>RMSE (nm)</th>
                      <th>Pearson</th>
                      <th>Spearman</th>
                      <th>Score</th>
                    </tr>
                  </thead>

                  <tbody>
                    {status.top_results.map((row) => (
                      <tr
                        key={`${row.elastic_force}-${row.elastic_lower}-${row.elastic_upper}`}
                      >
                        <td>{row.rank}</td>
                        <td>{row.elastic_force}</td>
                        <td>{row.elastic_lower}</td>
                        <td>{row.elastic_upper}</td>
                        <td>{row.rmse_nm.toFixed(4)}</td>
                        <td>{row.pearson.toFixed(3)}</td>
                        <td>{row.spearman.toFixed(3)}</td>
                        <td>{row.score.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>

              {running && (
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    mt: 1,
                    color: "text.secondary",
                  }}
                >
                  Rankings are provisional until the full grid completes.
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
    </Stack>
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
          <Typography variant="body2">
            GōMartini configuration will be exposed here.
          </Typography>
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