"use client";
import { motion } from "framer-motion";
import { Dispatch, SetStateAction } from "react";
import { CrossIcon } from "./icons/CrossIcon";
import { SearchIcon } from "./icons/SearchIcon";

type PropTypes = {
  searchVal: string;
  setSearchVal: Dispatch<SetStateAction<string>>;
};

export const SearchInputForChatList = ({
  searchVal,
  setSearchVal,
}: PropTypes) => {
  return (
    <div className="flex items-center bg-secondary-dark text-text px-2 rounded-md">
      <SearchIcon />
      <input
        value={searchVal}
        aria-label="Search chats"
        onChange={e => setSearchVal(e.target.value)}
        className="outline-none bg-inherit w-full  px-3 py-3"
        type="text"
        placeholder="Search"
      />
      {searchVal.trim().length > 0 && (
        <motion.button
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setSearchVal("")}
          aria-label="Clear search"
        >
          <CrossIcon />
        </motion.button>
      )}
    </div>
  );
};
