import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ChatWidget from "./components/ChatWidget";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Pricing from "./pages/Pricing";
import BookingPage from "./pages/Booking";
import BookingConfirmed from "./pages/BookingConfirmed";
import MembershipSignup from "./pages/MembershipSignup";

// Lazy — pulls in pdf-lib only when the applicant opens the form.
const MailboxApplication = lazy(() => import("./pages/MailboxApplication"));

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/pricing"} component={Pricing} />
      <Route path={"/booking"} component={BookingPage} />
      {/* Stripe returns the customer here after Checkout. */}
      <Route path={"/booking/confirmed"} component={BookingConfirmed} />
      <Route path={"/membership-signup"} component={MembershipSignup} />
      <Route path={"/mailbox-application"}>
        <Suspense fallback={<div className="min-h-screen bg-[#0A0A0A]" />}>
          <MailboxApplication />
        </Suspense>
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
          <ChatWidget />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
