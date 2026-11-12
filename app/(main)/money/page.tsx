import { PageHeader } from "@/components/PageHeader";

export default function Page() {
  return (
    <>
      <PageHeader back title="Money" />
      <div className="mx-auto max-w-[400px] px-8 py-10">
        <h2 className="text-[31px] font-extrabold leading-9">Nothing to see here — yet</h2>
        <p className="mt-2 text-[15px] leading-5 text-x-sec">
          This surface isn&rsquo;t part of the Totem phase-1 build.
        </p>
      </div>
    </>
  );
}
