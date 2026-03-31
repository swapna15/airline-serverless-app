import Link from "next/link";

const benefits = [
  {
    icon: "🔍",
    title: "Smart Flight Search",
    desc: "Search by origin, destination, and date. Filter results instantly and find the best available flights.",
  },
  {
    icon: "💺",
    title: "Choose Your Seat",
    desc: "Interactive seat maps let you pick exactly where you sit — window, aisle, or middle. Book multiple seats for your group.",
  },
  {
    icon: "👥",
    title: "Group Bookings",
    desc: "Select multiple seats in one go and enter each traveller's details. Everyone gets their own confirmed booking ID.",
  },
  {
    icon: "📋",
    title: "Instant Confirmation",
    desc: "Get a unique Booking ID the moment you confirm. Look it up anytime under My Bookings to see full reservation details.",
  },
  {
    icon: "🔄",
    title: "Real-Time Availability",
    desc: "Seat maps update live. What you see is what's available — no surprises at the gate.",
  },
  {
    icon: "🛠️",
    title: "Flight Management",
    desc: "Airline staff can reschedule flights, process cancellations, and manage individual seat statuses — all in one place.",
  },
];

const stats = [
  { value: "500+", label: "Flights Available" },
  { value: "50K+", label: "Happy Travellers" },
  { value: "99.9%", label: "Uptime" },
  { value: "24/7", label: "Support" },
];

export default function Home() {
  return (
    <main className="bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 py-20 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="text-5xl mb-4">✈</div>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">
            Fly smarter with AirApp
          </h1>
          <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">
            Search flights, pick your seat, and book in minutes. Simple, fast, and built for every kind of traveller.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/search"
              className="bg-white text-blue-700 font-bold px-8 py-3 rounded-full hover:bg-blue-50 transition text-sm"
            >
              Search Flights
            </Link>
            <Link
              href="/my-bookings"
              className="border border-white text-white font-semibold px-8 py-3 rounded-full hover:bg-blue-700 transition text-sm"
            >
              View My Booking
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-blue-50 px-6 py-10">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-3xl font-extrabold text-blue-600">{s.value}</p>
              <p className="text-sm text-gray-600 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-800 text-center mb-2">Why book with AirApp?</h2>
          <p className="text-gray-500 text-center mb-10 text-sm">Everything you need for a smooth journey, from search to boarding.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {benefits.map((b) => (
              <div key={b.title} className="bg-gray-50 rounded-xl p-6 flex flex-col gap-2 border border-gray-100">
                <span className="text-3xl">{b.icon}</span>
                <h3 className="font-bold text-gray-800">{b.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 px-6 py-16 border-t border-gray-100">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-800 text-center mb-10">How it works</h2>
          <div className="flex flex-col sm:flex-row gap-0 sm:gap-0 relative">
            {[
              { step: "1", title: "Search", desc: "Enter your origin, destination, and travel date to find available flights." },
              { step: "2", title: "Select Seats", desc: "Pick your preferred seats from the live seat map. Add traveller details for each seat." },
              { step: "3", title: "Confirm", desc: "Submit your booking and receive a unique Booking ID for each traveller instantly." },
            ].map((item, i) => (
              <div key={item.step} className="flex-1 flex flex-col items-center text-center px-4 relative">
                {i < 2 && (
                  <div className="hidden sm:block absolute top-5 right-0 w-full h-0.5 bg-blue-200 z-0" style={{ left: "50%" }} />
                )}
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-lg z-10 mb-3">
                  {item.step}
                </div>
                <h3 className="font-bold text-gray-800 mb-1">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Ready to take off?</h2>
          <p className="text-gray-500 text-sm mb-6">Find your next flight and book your seat in under 2 minutes.</p>
          <Link
            href="/search"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-10 py-3 rounded-full transition text-sm"
          >
            Search Flights Now
          </Link>
        </div>
      </section>
    </main>
  );
}
