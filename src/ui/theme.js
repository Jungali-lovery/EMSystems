import { createTheme } from '@mui/material/styles';

// Theme MUI giữ màu nhận diện EMSystems; business rules và API không phụ thuộc theme.
const emSystemsTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#176b8f', dark: '#145b7a', light: '#e6f2f7' },
    secondary: { main: '#40a7a0', dark: '#267c77', light: '#e7f5f3' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
    text: { primary: '#182638', secondary: '#708091' },
    divider: '#e2e8ed',
    success: { main: '#26775f' },
    warning: { main: '#9a6a17' },
    error: { main: '#b54747' },
  },
  shape: { borderRadius: 9 },
  typography: {
    fontFamily: "'Segoe UI Variable', 'Segoe UI', Arial, sans-serif",
    button: { fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
    h1: { fontWeight: 750, letterSpacing: '-0.04em' },
    h2: { fontWeight: 750, letterSpacing: '-0.035em' },
    h3: { fontWeight: 720, letterSpacing: '-0.025em' },
    h4: { fontWeight: 720, letterSpacing: '-0.02em' },
    subtitle1: { fontWeight: 700 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 38, borderRadius: 8, paddingInline: 14 },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { color: '#526579', fontWeight: 750, backgroundColor: '#f7f9fb' },
        root: { borderColor: '#e8edf1' },
      },
    },
  },
});

export default emSystemsTheme;