import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AppBar,
  Toolbar,
  Typography,
  Tabs,
  Tab,
  Box,
  Container,
  GlobalStyles,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

import Simulation from "./pages/Simulation.jsx";

export default function App() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);

  const renderPage = () => {
    switch (tab) {
      case 0:
        return <Simulation />;
      case 1:
        return <Typography variant="h5">Analysis</Typography>;
      case 2:
        return <Typography variant="h5">AA ↔ Martini</Typography>;
      default:
        return null;
    }
  };

  return (
    <Box
      sx={{
        background: theme.palette.background.default,
        color: "white",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      <GlobalStyles
        styles={{
          html: {
            scrollbarGutter: "stable both-edges",
          },
          body: {
            margin: 0,
            background: theme.palette.background.default,
            overflowX: "hidden !important",
          },
          "#root": {
            overflowX: "hidden !important",
          },
        }}
      />

      <AppBar
        position="sticky"
        sx={{
          background: "rgba(21,21,24,0.88)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "none",
        }}
      >
        <Toolbar>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexGrow: 1,
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                width: 38,
                height: 38,
                mr: 1.5,
                borderRadius: "50%",
                background:
                  "linear-gradient(135deg, #55a99f 0%, #8a78a8 100%)",
              }}
            />

            <Box>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 600,
                  color: theme.palette.primary.main,
                  lineHeight: 1.15,
                }}
              >
                Antibody Simulation Platform
              </Typography>

              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  letterSpacing: 0.8,
                }}
              >
                Multiscale Molecular Dynamics
              </Typography>
            </Box>
          </Box>

          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            textColor="inherit"
            indicatorColor="secondary"
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              flexShrink: 0,
              "& .MuiTabs-flexContainer": {
                justifyContent: "flex-end",
              },
              "& .MuiTab-root": {
                minHeight: 64,
                textTransform: "none",
                fontWeight: 500,
                whiteSpace: "nowrap",
              },
            }}
          >
            <Tab label="Simulation" />
            <Tab label="Analysis" />
            <Tab label="AA ↔ Martini" />
          </Tabs>
        </Toolbar>
      </AppBar>

      <Container
        maxWidth="xl"
        sx={{
          py: 4,
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          overflowX: "hidden",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {renderPage()}
          </motion.div>
        </AnimatePresence>
      </Container>
    </Box>
  );
}