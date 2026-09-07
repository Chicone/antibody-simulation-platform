import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",

    background: {
      default: "#151518",
      paper: "#1d1d21",
    },

    primary: {
      main: "#55a99f",
    },

    secondary: {
      main: "#8a78a8",
    },

    success: {
      main: "#72a875",
    },

    warning: {
      main: "#c5a35a",
    },

    error: {
      main: "#b86b78",
    },

    text: {
      primary: "#eeeeF0",
      secondary: "#9c9ca5",
    },
  },

  typography: {
    fontFamily: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",

    h4: {
      fontWeight: 600,
    },

    h5: {
      fontWeight: 600,
    },

    button: {
      textTransform: "none",
      fontWeight: 500,
    },
  },

  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 3,
          borderRadius: 3,
        },
      },
    },
  },
});

export default theme;